package server

import (
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"sovereign-media-hub/internal/auth"
	"sovereign-media-hub/internal/db"
	"sovereign-media-hub/internal/media"
	"sovereign-media-hub/internal/store"
)

var blobName = regexp.MustCompile(`^([0-9a-f]{64})(?:\.([a-z0-9]{1,8}))?$`)

// Descriptor is the Blossom blob descriptor (BUD-02).
type Descriptor struct {
	URL      string `json:"url"`
	SHA256   string `json:"sha256"`
	Size     int64  `json:"size"`
	Type     string `json:"type"`
	Uploaded int64  `json:"uploaded"`
}

func (s *Server) descriptor(sha, mime string, size, uploaded int64) Descriptor {
	u := s.cfg.BaseURL + "/" + sha
	if ext := media.ExtForMIME(mime); ext != "" {
		u += "." + ext
	}
	return Descriptor{URL: u, SHA256: sha, Size: size, Type: mime, Uploaded: uploaded}
}

func (s *Server) handleInfo(w http.ResponseWriter, r *http.Request) {
	policy := "open"
	if len(s.cfg.AllowedPubkeys) > 0 {
		policy = "allowlist"
	}
	reply(w, http.StatusOK, map[string]any{
		"name":             "Sovereign Media Hub storage server",
		"software":         "sovereign-media-hub",
		"version":          Version,
		"buds":             []int{1, 2, 6, 11, 12},
		"max_upload_bytes": s.cfg.MaxUploadBytes,
		"allowed_types":    media.Allowed(),
		"upload_policy":    policy,
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if err := s.db.Ping(); err != nil {
		fail(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	reply(w, http.StatusOK, map[string]any{"status": "ok", "version": Version})
}

// checkUploader applies the allow-list. Open servers accept any valid key.
func (s *Server) checkUploader(pubkey string) bool {
	if len(s.cfg.AllowedPubkeys) == 0 {
		return true
	}
	_, ok := s.cfg.AllowedPubkeys[pubkey]
	return ok
}

// uploadAuth validates the token for an upload or pre-flight and returns the
// hash declared in X-SHA-256 (empty if absent).
func (s *Server) uploadAuth(w http.ResponseWriter, r *http.Request) (tok *auth.Token, declared string, ok bool) {
	declared = r.Header.Get("X-SHA-256")
	if declared != "" && !auth.IsHash(declared) {
		fail(w, http.StatusBadRequest, "X-SHA-256 must be 64 lowercase hex characters")
		return nil, "", false
	}
	tok, err := s.auth.Authorize(r, auth.VerbUpload, declared)
	if err != nil {
		failAuth(w, err)
		return nil, "", false
	}
	if len(tok.Hashes) == 0 {
		fail(w, http.StatusUnauthorized, "upload token needs an x tag")
		return nil, "", false
	}
	if !s.checkUploader(tok.Pubkey) {
		fail(w, http.StatusForbidden, "this key may not upload to this server")
		return nil, "", false
	}
	return tok, declared, true
}

// handleUploadCheck implements HEAD /upload (BUD-06).
func (s *Server) handleUploadCheck(w http.ResponseWriter, r *http.Request) {
	tok, declared, ok := s.uploadAuth(w, r)
	if !ok {
		return
	}
	if declared == "" {
		fail(w, http.StatusBadRequest, "X-SHA-256 is required")
		return
	}
	_ = tok
	lenHeader := r.Header.Get("X-Content-Length")
	if lenHeader == "" {
		fail(w, http.StatusLengthRequired, "X-Content-Length is required")
		return
	}
	n, err := strconv.ParseInt(lenHeader, 10, 64)
	if err != nil || n < 0 {
		fail(w, http.StatusBadRequest, "X-Content-Length must be a non-negative integer")
		return
	}
	if n > s.cfg.MaxUploadBytes {
		fail(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("limit is %d bytes", s.cfg.MaxUploadBytes))
		return
	}
	if t := r.Header.Get("X-Content-Type"); t != "" && media.ExtForMIME(t) == "" {
		fail(w, http.StatusUnsupportedMediaType, "unsupported media type")
		return
	}
	w.WriteHeader(http.StatusOK)
}

// handleUpload implements PUT /upload (BUD-02).
func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	tok, declared, ok := s.uploadAuth(w, r)
	if !ok {
		return
	}
	if r.ContentLength > s.cfg.MaxUploadBytes {
		fail(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("limit is %d bytes", s.cfg.MaxUploadBytes))
		return
	}

	body := newStallReader(http.NewResponseController(w), r.Body, 30*time.Second)
	staged, err := s.store.Stage(body, s.cfg.MaxUploadBytes)
	if err != nil {
		var tooBig *http.MaxBytesError
		switch {
		case errors.Is(err, store.ErrUnsupportedType):
			fail(w, http.StatusUnsupportedMediaType, "only JPEG, PNG, GIF, WebP, AVIF, MP4, MOV and WebM are accepted")
		case errors.Is(err, store.ErrTooLarge), errors.As(err, &tooBig):
			fail(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("limit is %d bytes", s.cfg.MaxUploadBytes))
		default:
			s.log.Warn("upload interrupted", "err", err)
			fail(w, http.StatusBadRequest, "upload did not complete")
		}
		return
	}
	defer staged.Discard()

	if declared != "" && declared != staged.SHA256 {
		fail(w, http.StatusConflict, "X-SHA-256 does not match the uploaded bytes")
		return
	}
	if !tok.HasHash(staged.SHA256) {
		fail(w, http.StatusUnauthorized, "uploaded bytes do not match any hash authorised by the token")
		return
	}

	var existed bool
	var uploaded int64
	err = s.store.WithLock(staged.SHA256, func() error {
		var err error
		if existed, err = staged.Commit(); err != nil {
			return err
		}
		_, err = s.db.Record(tok.Pubkey, db.Blob{SHA256: staged.SHA256, Size: staged.Size, MIME: staged.Type.MIME})
		return err
	})
	if err != nil {
		s.log.Error("store upload", "err", err)
		fail(w, http.StatusInternalServerError, "could not store blob")
		return
	}
	uploaded = time.Now().Unix()

	status := http.StatusCreated
	if existed {
		status = http.StatusOK
	}
	reply(w, status, s.descriptor(staged.SHA256, staged.Type.MIME, staged.Size, uploaded))
}

// handleGet serves GET and HEAD /<sha256>[.ext] (BUD-01). Blobs are public.
func (s *Server) handleGet(w http.ResponseWriter, r *http.Request) {
	m := blobName.FindStringSubmatch(r.PathValue("blob"))
	if m == nil {
		fail(w, http.StatusNotFound, "not found")
		return
	}
	sha := m[1]

	row, err := s.db.Get(sha)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, http.StatusNotFound, "blob not found")
		return
	} else if err != nil {
		s.log.Error("lookup", "err", err)
		fail(w, http.StatusInternalServerError, "lookup failed")
		return
	}
	f, err := s.store.Open(sha)
	if err != nil {
		if !errors.Is(err, store.ErrNotFound) {
			s.log.Error("open blob", "err", err)
		} else {
			s.log.Error("blob row without file", "sha256", sha)
		}
		fail(w, http.StatusNotFound, "blob not found")
		return
	}
	defer f.Close()

	h := w.Header()
	h.Set("Content-Type", row.MIME)
	h.Set("Cache-Control", "public, max-age=31536000, immutable")
	h.Set("ETag", `"`+sha+`"`)
	h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	h.Set("Cross-Origin-Resource-Policy", "cross-origin")
	h.Set("Accept-Ranges", "bytes")
	http.ServeContent(w, r, "", time.Unix(row.CreatedAt, 0), f)
}

// handleDelete implements DELETE /<sha256> (BUD-12). Deleting removes the
// caller's claim on the blob; the file is removed only when no owner is left.
func (s *Server) handleDelete(w http.ResponseWriter, r *http.Request) {
	m := blobName.FindStringSubmatch(r.PathValue("blob"))
	if m == nil {
		fail(w, http.StatusNotFound, "not found")
		return
	}
	sha := m[1]

	tok, err := s.auth.Authorize(r, auth.VerbDelete, sha)
	if err != nil {
		failAuth(w, err)
		return
	}
	if !s.auth.Consume(tok) {
		fail(w, http.StatusUnauthorized, "token has already been used")
		return
	}

	var remaining int
	err = s.store.WithLock(sha, func() error {
		var err error
		if remaining, err = s.db.Unlink(tok.Pubkey, sha); err != nil {
			return err
		}
		if remaining == 0 {
			return s.store.Remove(sha)
		}
		return nil
	})
	switch {
	case errors.Is(err, db.ErrNotOwner):
		fail(w, http.StatusNotFound, "blob does not exist or is not yours to delete")
	case err != nil:
		s.log.Error("delete", "err", err)
		fail(w, http.StatusInternalServerError, "delete failed")
	default:
		reply(w, http.StatusOK, map[string]any{"sha256": sha, "file_removed": remaining == 0, "owners_remaining": remaining})
	}
}

// handleList implements GET /list/<pubkey> (BUD-12). Only the owner may list.
func (s *Server) handleList(w http.ResponseWriter, r *http.Request) {
	pubkey := r.PathValue("pubkey")
	if !auth.IsHash(pubkey) {
		fail(w, http.StatusBadRequest, "pubkey must be 64 lowercase hex characters")
		return
	}
	tok, err := s.auth.Authorize(r, auth.VerbList, "")
	if err != nil {
		failAuth(w, err)
		return
	}
	if tok.Pubkey != pubkey {
		fail(w, http.StatusForbidden, "tokens can only list the signer's own blobs")
		return
	}

	q := db.ListQuery{Owner: pubkey, Limit: 100}
	vals := r.URL.Query()
	if v := vals.Get("cursor"); v != "" {
		if !auth.IsHash(v) {
			fail(w, http.StatusBadRequest, "cursor must be a sha256")
			return
		}
		q.Cursor = v
	}
	for name, dst := range map[string]*int64{"since": &q.Since, "until": &q.Until} {
		if v := vals.Get(name); v != "" {
			n, err := strconv.ParseInt(v, 10, 64)
			if err != nil || n < 0 {
				fail(w, http.StatusBadRequest, name+" must be a Unix timestamp")
				return
			}
			*dst = n
		}
	}
	if v := vals.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 1000 {
			fail(w, http.StatusBadRequest, "limit must be between 1 and 1000")
			return
		}
		q.Limit = n
	}

	rows, err := s.db.List(q)
	if err != nil {
		s.log.Error("list", "err", err)
		fail(w, http.StatusInternalServerError, "list failed")
		return
	}
	out := make([]Descriptor, 0, len(rows))
	for _, o := range rows {
		out = append(out, s.descriptor(o.SHA256, o.MIME, o.Size, o.Uploaded))
	}
	reply(w, http.StatusOK, out)
}

// stallReader fails a read when the client sends nothing for too long, so slow
// connections cannot hold an upload slot open without a total-time limit that
// would also cut off legitimate large uploads.
type stallReader struct {
	rc   *http.ResponseController
	r    io.Reader
	idle time.Duration
}

func newStallReader(rc *http.ResponseController, r io.Reader, idle time.Duration) io.Reader {
	return &stallReader{rc: rc, r: r, idle: idle}
}

func (s *stallReader) Read(p []byte) (int, error) {
	// Ignore errors: recorders and some wrappers do not support deadlines.
	_ = s.rc.SetReadDeadline(time.Now().Add(s.idle))
	return s.r.Read(p)
}
