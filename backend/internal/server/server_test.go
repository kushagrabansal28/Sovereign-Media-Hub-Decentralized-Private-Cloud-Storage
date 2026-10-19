package server

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nbd-wtf/go-nostr"

	"sovereign-media-hub/internal/config"
	"sovereign-media-hub/internal/db"
	"sovereign-media-hub/internal/store"
)

type env struct {
	t    *testing.T
	dir  string
	cfg  *config.Config
	db   *db.DB
	st   *store.Store
	srv  *Server
	http *httptest.Server
}

func newEnv(t *testing.T, mutate func(*config.Config)) *env {
	t.Helper()
	return openEnv(t, t.TempDir(), mutate)
}

func openEnv(t *testing.T, dir string, mutate func(*config.Config)) *env {
	t.Helper()
	cfg, err := config.Load(func(k string) string {
		return map[string]string{"DATA_DIR": dir, "BASE_URL": "http://media.test", "RATE_LIMIT_PER_SECOND": "0"}[k]
	})
	if err != nil {
		t.Fatal(err)
	}
	cfg.MaxUploadBytes = 1 << 20
	if mutate != nil {
		mutate(cfg)
	}
	d, err := db.Open(filepath.Join(dir, "sovereign.db"))
	if err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	s := New(cfg, d, st, slog.New(slog.NewTextHandler(io.Discard, nil)))
	h := httptest.NewServer(s.Handler())
	e := &env{t: t, dir: dir, cfg: cfg, db: d, st: st, srv: s, http: h}
	t.Cleanup(e.close)
	return e
}

func (e *env) close() {
	e.http.Close()
	e.db.Close()
}

type key struct{ sk, pk string }

func newKey() key {
	sk := nostr.GeneratePrivateKey()
	pk, _ := nostr.GetPublicKey(sk)
	return key{sk, pk}
}

func (k key) token(verb string, ttl time.Duration, hashes ...string) string {
	tags := nostr.Tags{{"t", verb}, {"expiration", strconv.FormatInt(time.Now().Add(ttl).Unix(), 10)}}
	for _, h := range hashes {
		tags = append(tags, nostr.Tag{"x", h})
	}
	ev := &nostr.Event{Kind: 24242, CreatedAt: nostr.Timestamp(time.Now().Add(-time.Second).Unix()), Tags: tags, Content: verb}
	if err := ev.Sign(k.sk); err != nil {
		panic(err)
	}
	b, _ := json.Marshal(ev)
	return "Nostr " + base64.RawURLEncoding.EncodeToString(b)
}

func sha(b []byte) string { s := sha256.Sum256(b); return hex.EncodeToString(s[:]) }

// pngBytes returns a valid PNG; seed makes distinct images.
func pngBytes(seed int, size int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, size, size))
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			img.Set(x, y, color.RGBA{uint8(x + seed), uint8(y * seed), uint8(seed), 255})
		}
	}
	var b bytes.Buffer
	png.Encode(&b, img)
	return b.Bytes()
}

func (e *env) do(method, path string, body io.Reader, hdr map[string]string) *http.Response {
	e.t.Helper()
	req, err := http.NewRequest(method, e.http.URL+path, body)
	if err != nil {
		e.t.Fatal(err)
	}
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	return res
}

func (e *env) upload(k key, data []byte, extra map[string]string) *http.Response {
	e.t.Helper()
	h := map[string]string{"Authorization": k.token("upload", time.Minute, sha(data))}
	for a, b := range extra {
		h[a] = b
	}
	return e.do("PUT", "/upload", bytes.NewReader(data), h)
}

func decode[T any](t *testing.T, res *http.Response) T {
	t.Helper()
	defer res.Body.Close()
	var v T
	if err := json.NewDecoder(res.Body).Decode(&v); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return v
}

func want(t *testing.T, res *http.Response, status int) {
	t.Helper()
	if res.StatusCode != status {
		b, _ := io.ReadAll(res.Body)
		t.Fatalf("status %d, want %d (reason %q, body %s)", res.StatusCode, status, res.Header.Get("X-Reason"), b)
	}
}

func blobFiles(t *testing.T, dir string) []string {
	t.Helper()
	var out []string
	filepath.WalkDir(filepath.Join(dir, "blobs"), func(p string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			out = append(out, p)
		}
		return nil
	})
	return out
}

func TestUploadAndRetrieveRoundTrip(t *testing.T) {
	e := newEnv(t, nil)
	k := newKey()
	data := pngBytes(1, 64)

	res := e.upload(k, data, nil)
	want(t, res, http.StatusCreated)
	d := decode[Descriptor](t, res)
	if d.SHA256 != sha(data) || d.Size != int64(len(data)) || d.Type != "image/png" {
		t.Fatalf("descriptor %+v", d)
	}
	if d.URL != "http://media.test/"+d.SHA256+".png" {
		t.Fatalf("url %q", d.URL)
	}

	for _, path := range []string{"/" + d.SHA256, "/" + d.SHA256 + ".png", "/" + d.SHA256 + ".jpg"} {
		res = e.do("GET", path, nil, nil)
		want(t, res, http.StatusOK)
		got, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if !bytes.Equal(got, data) {
			t.Fatalf("%s returned different bytes", path)
		}
		h := res.Header
		if h.Get("Content-Type") != "image/png" || h.Get("X-Content-Type-Options") != "nosniff" ||
			h.Get("Access-Control-Allow-Origin") != "*" || !strings.Contains(h.Get("Cache-Control"), "immutable") ||
			!strings.Contains(h.Get("Content-Security-Policy"), "sandbox") {
			t.Fatalf("headers on %s: %v", path, h)
		}
	}

	res = e.do("HEAD", "/"+d.SHA256, nil, nil)
	want(t, res, http.StatusOK)
	if res.Header.Get("Content-Length") != strconv.Itoa(len(data)) || res.Header.Get("Accept-Ranges") != "bytes" {
		t.Fatalf("HEAD headers %v", res.Header)
	}
}

func TestRangeRequests(t *testing.T) {
	e := newEnv(t, nil)
	k := newKey()
	data := pngBytes(2, 80)
	h := decode[Descriptor](t, e.upload(k, data, nil)).SHA256

	res := e.do("GET", "/"+h, nil, map[string]string{"Range": "bytes=10-19"})
	want(t, res, http.StatusPartialContent)
	got, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if !bytes.Equal(got, data[10:20]) {
		t.Fatal("range returned wrong bytes")
	}
	res = e.do("GET", "/"+h, nil, map[string]string{"Range": "bytes=999999-"})
	want(t, res, http.StatusRequestedRangeNotSatisfiable)
}

func TestIdenticalUploadsStoreOneFile(t *testing.T) {
	e := newEnv(t, nil)
	a, b := newKey(), newKey()
	data := pngBytes(3, 64)

	want(t, e.upload(a, data, nil), http.StatusCreated)
	want(t, e.upload(a, data, nil), http.StatusOK)
	want(t, e.upload(b, data, nil), http.StatusOK)

	if files := blobFiles(t, e.dir); len(files) != 1 {
		t.Fatalf("%d files on disk, want 1: %v", len(files), files)
	}
	blobs, bytesTotal, _ := e.db.Totals()
	if blobs != 1 || bytesTotal != int64(len(data)) {
		t.Fatalf("db has %d blobs / %d bytes", blobs, bytesTotal)
	}
}

func TestDifferentFilesAreStoredSeparately(t *testing.T) {
	e := newEnv(t, nil)
	k := newKey()
	want(t, e.upload(k, pngBytes(4, 64), nil), http.StatusCreated)
	want(t, e.upload(k, pngBytes(5, 64), nil), http.StatusCreated)
	if files := blobFiles(t, e.dir); len(files) != 2 {
		t.Fatalf("%d files, want 2", len(files))
	}
}

func TestConcurrentIdenticalUploads(t *testing.T) {
	e := newEnv(t, nil)
	k := newKey()
	data := pngBytes(6, 128)

	var created, existed, other int32
	var wg sync.WaitGroup
	for i := 0; i < 24; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			res := e.upload(k, data, nil)
			io.Copy(io.Discard, res.Body)
			res.Body.Close()
			switch res.StatusCode {
			case http.StatusCreated:
				atomic.AddInt32(&created, 1)
			case http.StatusOK:
				atomic.AddInt32(&existed, 1)
			default:
				atomic.AddInt32(&other, 1)
			}
		}()
	}
	wg.Wait()

	if created != 1 || existed != 23 || other != 0 {
		t.Fatalf("created=%d existed=%d other=%d", created, existed, other)
	}
	if files := blobFiles(t, e.dir); len(files) != 1 {
		t.Fatalf("%d files", len(files))
	}
	if tmp, _ := os.ReadDir(filepath.Join(e.dir, "tmp")); len(tmp) != 0 {
		t.Fatalf("%d temp files left behind", len(tmp))
	}
	if err := e.st.Verify(sha(data)); err != nil {
		t.Fatal(err)
	}
}

func TestServerComputesTheHashItself(t *testing.T) {
	e := newEnv(t, nil)
	k := newKey()
	data := pngBytes(7, 64)
	other := pngBytes(8, 64)

	t.Run("X-SHA-256 that disagrees with the body", func(t *testing.T) {
		h := map[string]string{
			"Authorization": k.token("upload", time.Minute, sha(other)),
			"X-SHA-256":     sha(other),
		}
		res := e.do("PUT", "/upload", bytes.NewReader(data), h)
		want(t, res, http.StatusConflict)
	})
	t.Run("token authorises a different blob than the body", func(t *testing.T) {
		h := map[string]string{"Authorization": k.token("upload", time.Minute, sha(other))}
		res := e.do("PUT", "/upload", bytes.NewReader(data), h)
		want(t, res, http.StatusUnauthorized)
	})
	t.Run("nothing was stored by the failures", func(t *testing.T) {
		if files := blobFiles(t, e.dir); len(files) != 0 {
			t.Fatalf("%d files stored", len(files))
		}
	})
	t.Run("token without an x tag", func(t *testing.T) {
		res := e.do("PUT", "/upload", bytes.NewReader(data), map[string]string{"Authorization": k.token("upload", time.Minute)})
		want(t, res, http.StatusUnauthorized)
	})
	t.Run("malformed X-SHA-256", func(t *testing.T) {
		res := e.upload(k, data, map[string]string{"X-SHA-256": "xyz"})
		want(t, res, http.StatusBadRequest)
	})
}

func TestTruncatedUploadIsNotStoredAsTheIntendedBlob(t *testing.T) {
	e := newEnv(t, nil)
	k := newKey()
	full := pngBytes(9, 128)
	truncated := full[:len(full)/2]

	// The client signs the hash of the complete file but only the first half
	// arrives with a matching Content-Length, so the server hashes different bytes.
	h := map[string]string{
		"Authorization": k.token("upload", time.Minute, sha(full)),
		"X-SHA-256":     sha(full),
	}
	res := e.do("PUT", "/upload", bytes.NewReader(truncated), h)
	want(t, res, http.StatusConflict)
	if res := e.do("GET", "/"+sha(full), nil, nil); res.StatusCode != http.StatusNotFound {
		t.Fatalf("corrupt upload became retrievable: %d", res.StatusCode)
	}
	if files := blobFiles(t, e.dir); len(files) != 0 {
		t.Fatalf("%d files", len(files))
	}
}

func TestInterruptedUploadLeavesNoTempFile(t *testing.T) {
	e := newEnv(t, nil)
	k := newKey()
	data := pngBytes(10, 128)

	pr, pw := io.Pipe()
	req, _ := http.NewRequest("PUT", e.http.URL+"/upload", pr)
	req.Header.Set("Authorization", k.token("upload", time.Minute, sha(data)))
	req.ContentLength = int64(len(data))
	done := make(chan struct{})
	go func() {
		http.DefaultClient.Do(req)
		close(done)
	}()
	pw.Write(data[:len(data)/3])
	pw.CloseWithError(io.ErrUnexpectedEOF)
	<-done

	deadline := time.Now().Add(3 * time.Second)
	for {
		tmp, _ := os.ReadDir(filepath.Join(e.dir, "tmp"))
		if len(tmp) == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("%d temp files remain", len(tmp))
		}
		time.Sleep(20 * time.Millisecond)
	}
	if files := blobFiles(t, e.dir); len(files) != 0 {
		t.Fatalf("partial blob stored: %v", files)
	}
}

func TestRejectsUnsupportedAndDangerousTypes(t *testing.T) {
	e := newEnv(t, nil)
	k := newKey()
	for name, body := range map[string][]byte{
		"html":      []byte("<!doctype html><script>alert(1)</script>"),
		"svg":       []byte(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>`),
		"text":      []byte("hello world, this is plain text with enough length"),
		"empty":     {},
		"mp3":       append([]byte("ID3"), make([]byte, 64)...),
		"heic":      append([]byte{0, 0, 0, 0x18}, []byte("ftypheic")...),
		"php":       []byte("<?php system($_GET['c']); ?>"),
		"zip":       {'P', 'K', 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
		"jpeg head": {0xFF, 0xD8},
	} {
		t.Run(name, func(t *testing.T) {
			res := e.upload(k, body, map[string]string{"Content-Type": "image/png"})
			if name == "jpeg head" {
				// Two bytes are too short to identify a JPEG; must not be accepted.
				if res.StatusCode == http.StatusCreated {
					t.Fatal("accepted a 2-byte file")
				}
				return
			}
			want(t, res, http.StatusUnsupportedMediaType)
		})
	}
	if files := blobFiles(t, e.dir); len(files) != 0 {
		t.Fatalf("%d files stored", len(files))
	}
}

func TestSniffedTypeWinsOverDeclaredType(t *testing.T) {
	e := newEnv(t, nil)
	k := newKey()
	data := pngBytes(11, 32)
	res := e.upload(k, data, map[string]string{"Content-Type": "text/html"})
	want(t, res, http.StatusCreated)
	if d := decode[Descriptor](t, res); d.Type != "image/png" {
		t.Fatalf("type %q", d.Type)
	}
}

func TestEnforcesSizeLimit(t *testing.T) {
	big := pngBytes(12, 128)
	limit := int64(len(big) - 1)
	e := newEnv(t, func(c *config.Config) { c.MaxUploadBytes = limit })
	k := newKey()
	want(t, e.upload(k, big, nil), http.StatusRequestEntityTooLarge)

	// Unknown length (chunked) must be capped as well.
	pr, pw := io.Pipe()
	go func() { pw.Write(big); pw.Close() }()
	req, _ := http.NewRequest("PUT", e.http.URL+"/upload", pr)
	req.ContentLength = -1
	req.Header.Set("Authorization", k.token("upload", time.Minute, sha(big)))
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	want(t, res, http.StatusRequestEntityTooLarge)
	if files := blobFiles(t, e.dir); len(files) != 0 {
		t.Fatalf("%d files", len(files))
	}
}

func TestMalformedBlobPaths(t *testing.T) {
	e := newEnv(t, nil)
	k := newKey()
	h := decode[Descriptor](t, e.upload(k, pngBytes(13, 32), nil)).SHA256
	for _, p := range []string{
		"/" + strings.ToUpper(h),
		"/" + h[:63],
		"/" + h + "0",
		"/" + h + ".",
		"/" + h + ".tar.gz",
		"/..%2f..%2fetc%2fpasswd",
		"/..%5c..%5cwindows%5cwin.ini",
		"/" + strings.Repeat("g", 64),
		"/" + strings.Repeat("a", 64) + ".png", // well-formed but absent
		"/blobs",
	} {
		res := e.do("GET", p, nil, nil)
		if res.StatusCode != http.StatusNotFound && res.StatusCode != http.StatusMovedPermanently {
			t.Errorf("GET %s -> %d", p, res.StatusCode)
		}
		res.Body.Close()
	}
}

func TestRequestsWithoutValidAuthAreRejected(t *testing.T) {
	e := newEnv(t, nil)
	owner, intruder := newKey(), newKey()
	data := pngBytes(14, 32)
	h := decode[Descriptor](t, e.upload(owner, data, nil)).SHA256

	for name, req := range map[string]func() *http.Response{
		"upload without header": func() *http.Response { return e.do("PUT", "/upload", bytes.NewReader(data), nil) },
		"delete without header": func() *http.Response { return e.do("DELETE", "/"+h, nil, nil) },
		"list without header":   func() *http.Response { return e.do("GET", "/list/"+owner.pk, nil, nil) },
		"delete with upload token": func() *http.Response {
			return e.do("DELETE", "/"+h, nil, map[string]string{"Authorization": owner.token("upload", time.Minute, h)})
		},
		"delete token for another blob": func() *http.Response {
			return e.do("DELETE", "/"+h, nil, map[string]string{"Authorization": owner.token("delete", time.Minute, sha([]byte("other")))})
		},
		"delete token without x": func() *http.Response {
			return e.do("DELETE", "/"+h, nil, map[string]string{"Authorization": owner.token("delete", time.Minute)})
		},
		"expired token": func() *http.Response {
			return e.do("DELETE", "/"+h, nil, map[string]string{"Authorization": owner.token("delete", -time.Minute, h)})
		},
	} {
		res := req()
		if res.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s: status %d", name, res.StatusCode)
		}
		if res.Header.Get("X-Reason") == "" {
			t.Errorf("%s: no X-Reason", name)
		}
		res.Body.Close()
	}

	// A valid token from a different key must not delete someone else's blob.
	res := e.do("DELETE", "/"+h, nil, map[string]string{"Authorization": intruder.token("delete", time.Minute, h)})
	want(t, res, http.StatusNotFound)
	want(t, e.do("HEAD", "/"+h, nil, nil), http.StatusOK)
}

func TestDeleteKeepsBlobWhileAnotherOwnerRemains(t *testing.T) {
	e := newEnv(t, nil)
	a, b := newKey(), newKey()
	data := pngBytes(15, 48)
	h := decode[Descriptor](t, e.upload(a, data, nil)).SHA256
	want(t, e.upload(b, data, nil), http.StatusOK)

	res := e.do("DELETE", "/"+h, nil, map[string]string{"Authorization": a.token("delete", time.Minute, h)})
	want(t, res, http.StatusOK)
	out := decode[map[string]any](t, res)
	if out["file_removed"] != false || out["owners_remaining"] != float64(1) {
		t.Fatalf("response %v", out)
	}
	want(t, e.do("GET", "/"+h, nil, nil), http.StatusOK)

	// a no longer sees it, b still does
	res = e.do("GET", "/list/"+a.pk, nil, map[string]string{"Authorization": a.token("list", time.Minute)})
	if l := decode[[]Descriptor](t, res); len(l) != 0 {
		t.Fatalf("a still lists %d blobs", len(l))
	}

	res = e.do("DELETE", "/"+h, nil, map[string]string{"Authorization": b.token("delete", time.Minute, h)})
	want(t, res, http.StatusOK)
	if out := decode[map[string]any](t, res); out["file_removed"] != true {
		t.Fatalf("last owner should remove the file: %v", out)
	}
	want(t, e.do("GET", "/"+h, nil, nil), http.StatusNotFound)
	if files := blobFiles(t, e.dir); len(files) != 0 {
		t.Fatalf("file remains: %v", files)
	}
}

func TestDeleteTokenCannotBeReplayed(t *testing.T) {
	e := newEnv(t, nil)
	k := newKey()
	data := pngBytes(16, 48)
	h := sha(data)
	want(t, e.upload(k, data, nil), http.StatusCreated)

	tok := k.token("delete", time.Minute, h)
	want(t, e.do("DELETE", "/"+h, nil, map[string]string{"Authorization": tok}), http.StatusOK)

	// The same content is uploaded again, then the captured token is replayed.
	want(t, e.upload(k, data, nil), http.StatusCreated)
	want(t, e.do("DELETE", "/"+h, nil, map[string]string{"Authorization": tok}), http.StatusUnauthorized)
	want(t, e.do("HEAD", "/"+h, nil, nil), http.StatusOK)
}

func TestConcurrentUploadAndDeleteNeverDangle(t *testing.T) {
	e := newEnv(t, nil)
	k := newKey()
	data := pngBytes(17, 64)
	h := sha(data)

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			res := e.upload(k, data, nil)
			io.Copy(io.Discard, res.Body)
			res.Body.Close()
		}()
		go func() {
			defer wg.Done()
			res := e.do("DELETE", "/"+h, nil, map[string]string{"Authorization": k.token("delete", time.Minute, h)})
			io.Copy(io.Discard, res.Body)
			res.Body.Close()
		}()
	}
	wg.Wait()

	// Whatever the interleaving, the database and the disk must agree.
	_, dbErr := e.db.Get(h)
	onDisk := e.st.Exists(h)
	if (dbErr == nil) != onDisk {
		t.Fatalf("database has blob=%v but disk has blob=%v", dbErr == nil, onDisk)
	}
	if onDisk {
		if err := e.st.Verify(h); err != nil {
			t.Fatal(err)
		}
	}
}

func TestAllowListRestrictsUploads(t *testing.T) {
	allowed, other := newKey(), newKey()
	e := newEnv(t, func(c *config.Config) { c.AllowedPubkeys = map[string]struct{}{allowed.pk: {}} })
	data := pngBytes(18, 32)
	want(t, e.upload(other, data, nil), http.StatusForbidden)
	want(t, e.upload(allowed, data, nil), http.StatusCreated)

	info := decode[map[string]any](t, e.do("GET", "/", nil, nil))
	if info["upload_policy"] != "allowlist" {
		t.Fatalf("info %v", info)
	}
}

func TestUploadPreflight(t *testing.T) {
	e := newEnv(t, nil)
	k := newKey()
	data := pngBytes(19, 32)
	h := sha(data)
	good := map[string]string{
		"Authorization":    k.token("upload", time.Minute, h),
		"X-SHA-256":        h,
		"X-Content-Length": strconv.Itoa(len(data)),
		"X-Content-Type":   "image/png",
	}
	want(t, e.do("HEAD", "/upload", nil, good), http.StatusOK)

	bad := func(mod func(map[string]string)) map[string]string {
		m := map[string]string{}
		for a, b := range good {
			m[a] = b
		}
		mod(m)
		return m
	}
	want(t, e.do("HEAD", "/upload", nil, bad(func(m map[string]string) { m["X-Content-Length"] = "99999999" })), http.StatusRequestEntityTooLarge)
	want(t, e.do("HEAD", "/upload", nil, bad(func(m map[string]string) { m["X-Content-Type"] = "text/html" })), http.StatusUnsupportedMediaType)
	want(t, e.do("HEAD", "/upload", nil, bad(func(m map[string]string) { delete(m, "X-Content-Length") })), http.StatusLengthRequired)
	want(t, e.do("HEAD", "/upload", nil, bad(func(m map[string]string) { delete(m, "Authorization") })), http.StatusUnauthorized)
	want(t, e.do("HEAD", "/upload", nil, bad(func(m map[string]string) { m["X-SHA-256"] = "nope" })), http.StatusBadRequest)
}

func TestListPaginationAndOwnership(t *testing.T) {
	e := newEnv(t, nil)
	k, other := newKey(), newKey()
	var hashes []string
	for i := 0; i < 5; i++ {
		d := pngBytes(30+i, 32)
		want(t, e.upload(k, d, nil), http.StatusCreated)
		hashes = append(hashes, sha(d))
	}
	// Force distinct upload times so ordering is checkable.
	for i, h := range hashes {
		e.exec(t, `UPDATE owners SET uploaded = ? WHERE sha256 = ?`, 1_700_000_000+i*10, h)
	}

	list := func(q string) []Descriptor {
		res := e.do("GET", "/list/"+k.pk+q, nil, map[string]string{"Authorization": k.token("list", time.Minute)})
		want(t, res, http.StatusOK)
		return decode[[]Descriptor](t, res)
	}
	all := list("")
	if len(all) != 5 || all[0].SHA256 != hashes[4] || all[4].SHA256 != hashes[0] {
		t.Fatalf("order wrong: %+v", all)
	}
	page1 := list("?limit=2")
	page2 := list("?limit=2&cursor=" + page1[1].SHA256)
	page3 := list("?limit=2&cursor=" + page2[1].SHA256)
	if len(page1) != 2 || len(page2) != 2 || len(page3) != 1 {
		t.Fatalf("page sizes %d %d %d", len(page1), len(page2), len(page3))
	}
	seen := map[string]bool{}
	for _, p := range [][]Descriptor{page1, page2, page3} {
		for _, d := range p {
			if seen[d.SHA256] {
				t.Fatalf("duplicate %s across pages", d.SHA256)
			}
			seen[d.SHA256] = true
		}
	}

	res := e.do("GET", "/list/"+other.pk, nil, map[string]string{"Authorization": k.token("list", time.Minute)})
	want(t, res, http.StatusForbidden)
	res = e.do("GET", "/list/"+k.pk+"?limit=0", nil, map[string]string{"Authorization": k.token("list", time.Minute)})
	want(t, res, http.StatusBadRequest)
	res = e.do("GET", "/list/not-a-key", nil, map[string]string{"Authorization": k.token("list", time.Minute)})
	want(t, res, http.StatusBadRequest)
}

func (e *env) exec(t *testing.T, q string, args ...any) {
	t.Helper()
	// The test reaches under the DB wrapper only to set up timestamps.
	if err := e.db.Exec(q, args...); err != nil {
		t.Fatal(err)
	}
}

func TestDataSurvivesRestart(t *testing.T) {
	dir := t.TempDir()
	k := newKey()
	data := pngBytes(40, 96)

	e1 := openEnv(t, dir, nil)
	h := decode[Descriptor](t, e1.upload(k, data, nil)).SHA256
	e1.close()

	e2 := openEnv(t, dir, nil)
	if err := Reconcile(e2.db, e2.st, slog.New(slog.NewTextHandler(io.Discard, nil))); err != nil {
		t.Fatal(err)
	}
	res := e2.do("GET", "/"+h, nil, nil)
	want(t, res, http.StatusOK)
	got, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if !bytes.Equal(got, data) {
		t.Fatal("bytes changed across restart")
	}
	res = e2.do("GET", "/list/"+k.pk, nil, map[string]string{"Authorization": k.token("list", time.Minute)})
	if l := decode[[]Descriptor](t, res); len(l) != 1 {
		t.Fatalf("ownership lost: %d", len(l))
	}
	// Uploading again after a restart still deduplicates.
	want(t, e2.upload(k, data, nil), http.StatusOK)
	if files := blobFiles(t, dir); len(files) != 1 {
		t.Fatalf("%d files", len(files))
	}
}

func TestReconcileDropsRowsWithoutFiles(t *testing.T) {
	e := newEnv(t, nil)
	k := newKey()
	data := pngBytes(41, 32)
	h := sha(data)
	want(t, e.upload(k, data, nil), http.StatusCreated)

	if err := e.st.Remove(h); err != nil {
		t.Fatal(err)
	}
	if err := Reconcile(e.db, e.st, slog.New(slog.NewTextHandler(io.Discard, nil))); err != nil {
		t.Fatal(err)
	}
	if _, err := e.db.Get(h); err == nil {
		t.Fatal("row for a missing file was kept")
	}
	want(t, e.upload(k, data, nil), http.StatusCreated)
}

func TestUnreferencedFileIsAdoptedByNextUpload(t *testing.T) {
	e := newEnv(t, nil)
	k := newKey()
	data := pngBytes(42, 32)
	h := sha(data)
	want(t, e.upload(k, data, nil), http.StatusCreated)
	e.exec(t, `DELETE FROM blobs WHERE sha256 = ?`, h) // simulates a restored older database

	if err := Reconcile(e.db, e.st, slog.New(slog.NewTextHandler(io.Discard, nil))); err != nil {
		t.Fatal(err)
	}
	if !e.st.Exists(h) {
		t.Fatal("reconcile deleted a file")
	}
	want(t, e.upload(k, data, nil), http.StatusOK)
	want(t, e.do("GET", "/"+h, nil, nil), http.StatusOK)
}

func TestStartupRemovesStaleTempFiles(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "tmp"), 0o750)
	os.WriteFile(filepath.Join(dir, "tmp", "upload-123"), []byte("partial"), 0o640)
	if _, err := store.Open(dir); err != nil {
		t.Fatal(err)
	}
	if tmp, _ := os.ReadDir(filepath.Join(dir, "tmp")); len(tmp) != 0 {
		t.Fatalf("%d stale temp files survived startup", len(tmp))
	}
}

func TestScrubDetectsCorruptedBlob(t *testing.T) {
	e := newEnv(t, nil)
	k := newKey()
	data := pngBytes(43, 64)
	h := decode[Descriptor](t, e.upload(k, data, nil)).SHA256
	if err := e.st.Verify(h); err != nil {
		t.Fatal(err)
	}
	p := blobFiles(t, e.dir)[0]
	os.WriteFile(p, append(data[:len(data)-1:len(data)-1], 0), 0o640)
	if err := e.st.Verify(h); err == nil {
		t.Fatal("corruption not detected")
	}
}

func TestCORSAndInfo(t *testing.T) {
	e := newEnv(t, nil)
	res := e.do("OPTIONS", "/upload", nil, map[string]string{"Origin": "https://app.example", "Access-Control-Request-Method": "PUT"})
	want(t, res, http.StatusNoContent)
	if res.Header.Get("Access-Control-Allow-Origin") != "*" ||
		!strings.Contains(res.Header.Get("Access-Control-Allow-Headers"), "Authorization") ||
		!strings.Contains(res.Header.Get("Access-Control-Allow-Methods"), "DELETE") {
		t.Fatalf("preflight headers %v", res.Header)
	}
	// Error responses must also carry CORS headers or the browser hides the reason.
	res = e.do("GET", "/"+strings.Repeat("a", 64), nil, nil)
	if res.Header.Get("Access-Control-Allow-Origin") != "*" || res.StatusCode != 404 {
		t.Fatalf("404 headers %v", res.Header)
	}
	want(t, e.do("GET", "/health", nil, nil), http.StatusOK)
	info := decode[map[string]any](t, e.do("GET", "/", nil, nil))
	if info["max_upload_bytes"] != float64(1<<20) {
		t.Fatalf("info %v", info)
	}
}

func TestRateLimit(t *testing.T) {
	e := newEnv(t, func(c *config.Config) { c.RateLimit = 0.001; c.RateBurst = 3 })
	k := newKey()
	var limited int
	for i := 0; i < 8; i++ {
		res := e.do("GET", "/list/"+k.pk, nil, map[string]string{"Authorization": k.token("list", time.Minute)})
		if res.StatusCode == http.StatusTooManyRequests {
			limited++
			if res.Header.Get("Retry-After") == "" {
				t.Fatal("no Retry-After")
			}
		}
		res.Body.Close()
	}
	if limited != 5 {
		t.Fatalf("%d requests limited, want 5", limited)
	}
	// Reads are not limited so a gallery can load many thumbnails.
	for i := 0; i < 20; i++ {
		res := e.do("GET", "/"+strings.Repeat("c", 64), nil, nil)
		if res.StatusCode == http.StatusTooManyRequests {
			t.Fatal("blob reads must not be rate limited")
		}
		res.Body.Close()
	}
}

func TestSQLitePragmasTakeEffect(t *testing.T) {
	e := newEnv(t, nil)
	for name, want := range map[string]string{"journal_mode": "wal", "foreign_keys": "1", "busy_timeout": "5000"} {
		got, err := e.db.Pragma(name)
		if err != nil || got != want {
			t.Errorf("PRAGMA %s = %q (err %v), want %q", name, got, err, want)
		}
	}
}
