package auth

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/nbd-wtf/go-nostr"
)

const hashA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const hashB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

var fixedNow = time.Unix(1_800_000_000, 0)

func newVerifier() *Verifier {
	v := NewVerifier([]string{"media.example.org"}, time.Hour, time.Minute)
	v.Now = func() time.Time { return fixedNow }
	return v
}

type tok struct {
	sk      string
	kind    int
	created time.Time
	tags    nostr.Tags
}

func defaults() tok {
	return tok{
		sk:      nostr.GeneratePrivateKey(),
		kind:    KindBlossomAuth,
		created: fixedNow.Add(-10 * time.Second),
		tags: nostr.Tags{
			{"t", "upload"},
			{"x", hashA},
			{"expiration", strconv.FormatInt(fixedNow.Add(5*time.Minute).Unix(), 10)},
		},
	}
}

func (c tok) event() *nostr.Event {
	ev := &nostr.Event{Kind: c.kind, CreatedAt: nostr.Timestamp(c.created.Unix()), Tags: c.tags, Content: "Upload"}
	if err := ev.Sign(c.sk); err != nil {
		panic(err)
	}
	return ev
}

func header(ev *nostr.Event, enc *base64.Encoding) string {
	b, _ := json.Marshal(ev)
	return "Nostr " + enc.EncodeToString(b)
}

func TestParseAcceptsValidToken(t *testing.T) {
	c := defaults()
	got, err := newVerifier().Parse(header(c.event(), base64.RawURLEncoding), VerbUpload)
	if err != nil {
		t.Fatal(err)
	}
	if got.Verb != VerbUpload || !got.HasHash(hashA) || got.HasHash(hashB) {
		t.Fatalf("unexpected token %+v", got)
	}
}

func TestParseAcceptsLegacyBase64Variants(t *testing.T) {
	for name, enc := range map[string]*base64.Encoding{"std": base64.StdEncoding, "url-padded": base64.URLEncoding} {
		if _, err := newVerifier().Parse(header(defaults().event(), enc), VerbUpload); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestParseRejects(t *testing.T) {
	exp := func(d time.Duration) []string {
		return []string{"expiration", strconv.FormatInt(fixedNow.Add(d).Unix(), 10)}
	}
	cases := map[string]func(c *tok){
		"wrong kind (NIP-98)":     func(c *tok) { c.kind = 27235 },
		"created in the future":   func(c *tok) { c.created = fixedNow.Add(10 * time.Minute) },
		"expired":                 func(c *tok) { c.tags = nostr.Tags{{"t", "upload"}, {"x", hashA}, exp(-time.Second)} },
		"expiration missing":      func(c *tok) { c.tags = nostr.Tags{{"t", "upload"}, {"x", hashA}} },
		"expiration not a number": func(c *tok) { c.tags = nostr.Tags{{"t", "upload"}, {"x", hashA}, {"expiration", "soon"}} },
		"expiration too far":      func(c *tok) { c.tags = nostr.Tags{{"t", "upload"}, {"x", hashA}, exp(48 * time.Hour)} },
		"wrong verb":              func(c *tok) { c.tags = nostr.Tags{{"t", "delete"}, {"x", hashA}, exp(time.Minute)} },
		"two verbs":               func(c *tok) { c.tags = nostr.Tags{{"t", "upload"}, {"t", "delete"}, {"x", hashA}, exp(time.Minute)} },
		"no verb":                 func(c *tok) { c.tags = nostr.Tags{{"x", hashA}, exp(time.Minute)} },
		"short tag":               func(c *tok) { c.tags = nostr.Tags{{"t"}, exp(time.Minute)} },
		"bad x tag":               func(c *tok) { c.tags = nostr.Tags{{"t", "upload"}, {"x", "ABC"}, exp(time.Minute)} },
		"uppercase x tag":         func(c *tok) { c.tags = nostr.Tags{{"t", "upload"}, {"x", strings.ToUpper(hashA)}, exp(time.Minute)} },
		"other server":            func(c *tok) { c.tags = append(defaults().tags, nostr.Tag{"server", "other.example.net"}) },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			c := defaults()
			mutate(&c)
			_, err := newVerifier().Parse(header(c.event(), base64.RawURLEncoding), VerbUpload)
			ae, ok := err.(*Error)
			if !ok || ae.Status != http.StatusUnauthorized {
				t.Fatalf("expected 401 *Error, got %v", err)
			}
		})
	}
}

func TestServerTagMatchesConfiguredHost(t *testing.T) {
	c := defaults()
	c.tags = append(c.tags, nostr.Tag{"server", "other.example.net"}, nostr.Tag{"server", "media.example.org"})
	if _, err := newVerifier().Parse(header(c.event(), base64.RawURLEncoding), VerbUpload); err != nil {
		t.Fatalf("one matching server tag should be enough: %v", err)
	}
}

func TestParseRejectsTamperedEvents(t *testing.T) {
	v := newVerifier()

	t.Run("signature from another key", func(t *testing.T) {
		ev := defaults().event()
		other := defaults().event()
		ev.Sig = other.Sig
		if _, err := v.Parse(header(ev, base64.RawURLEncoding), VerbUpload); err == nil {
			t.Fatal("accepted a signature made over a different event")
		}
	})
	t.Run("content changed after signing", func(t *testing.T) {
		ev := defaults().event()
		ev.Tags = append(ev.Tags, nostr.Tag{"x", hashB})
		if _, err := v.Parse(header(ev, base64.RawURLEncoding), VerbUpload); err == nil {
			t.Fatal("accepted modified tags")
		}
	})
	t.Run("forged id", func(t *testing.T) {
		// The id is recomputed by the verifier. A signature that is valid for the
		// real content must not pass when the id field claims something else.
		ev := defaults().event()
		ev.ID = strings.Repeat("0", 64)
		if _, err := v.Parse(header(ev, base64.RawURLEncoding), VerbUpload); err == nil {
			t.Fatal("accepted an event whose id does not match its content")
		}
	})
	t.Run("pubkey swapped", func(t *testing.T) {
		ev := defaults().event()
		ev.PubKey, _ = nostr.GetPublicKey(nostr.GeneratePrivateKey())
		if _, err := v.Parse(header(ev, base64.RawURLEncoding), VerbUpload); err == nil {
			t.Fatal("accepted a swapped pubkey")
		}
	})
}

func TestParseRejectsMalformedHeaders(t *testing.T) {
	v := newVerifier()
	good := header(defaults().event(), base64.RawURLEncoding)
	for name, h := range map[string]string{
		"empty":          "",
		"wrong scheme":   "Bearer " + strings.TrimPrefix(good, "Nostr "),
		"no payload":     "Nostr",
		"not base64":     "Nostr !!!!",
		"not json":       "Nostr " + base64.RawURLEncoding.EncodeToString([]byte("hello")),
		"json not event": "Nostr " + base64.RawURLEncoding.EncodeToString([]byte(`{"kind":"x"}`)),
		"oversized":      "Nostr " + strings.Repeat("A", maxHeaderBytes+1),
	} {
		if _, err := v.Parse(h, VerbUpload); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestAuthorizeRequiresMatchingHash(t *testing.T) {
	v := newVerifier()
	r, _ := http.NewRequest("PUT", "/upload", nil)
	r.Header.Set("Authorization", header(defaults().event(), base64.RawURLEncoding))
	if _, err := v.Authorize(r, VerbUpload, hashA); err != nil {
		t.Fatalf("matching hash rejected: %v", err)
	}
	if _, err := v.Authorize(r, VerbUpload, hashB); err == nil {
		t.Fatal("token for hash A authorised hash B")
	}
}

func TestConsumeIsSingleUse(t *testing.T) {
	v := newVerifier()
	got, err := v.Parse(header(defaults().event(), base64.RawURLEncoding), VerbUpload)
	if err != nil {
		t.Fatal(err)
	}
	if !v.Consume(got) {
		t.Fatal("first use refused")
	}
	if v.Consume(got) {
		t.Fatal("replay accepted")
	}
}

func TestConsumeFailsClosedWhenFull(t *testing.T) {
	c := newOnceCache(2)
	until := time.Now().Add(time.Hour)
	if !c.add("a", until) || !c.add("b", until) {
		t.Fatal("setup")
	}
	if c.add("c", until) {
		t.Fatal("cache forgot live ids instead of refusing")
	}
	c.seen["a"] = time.Now().Add(-time.Second)
	if !c.add("c", until) {
		t.Fatal("expired entry should have been evicted")
	}
}
