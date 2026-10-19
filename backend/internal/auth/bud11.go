// Package auth validates Blossom authorization tokens (BUD-11).
//
// A token is a signed Nostr event of kind 24242 carried in
// "Authorization: Nostr <base64url(event JSON)>". This is not NIP-98.
package auth

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/nbd-wtf/go-nostr"
)

const KindBlossomAuth = 24242

// Verbs defined by BUD-11.
const (
	VerbGet    = "get"
	VerbUpload = "upload"
	VerbList   = "list"
	VerbDelete = "delete"
)

const maxHeaderBytes = 16 * 1024

// Error is an authorization failure. Status is 401 for missing or invalid
// tokens and 403 when a valid token is not allowed to do what was asked.
type Error struct {
	Status int
	Reason string
}

func (e *Error) Error() string { return e.Reason }

func unauthorized(format string, a ...any) *Error {
	return &Error{http.StatusUnauthorized, fmt.Sprintf(format, a...)}
}

// Token is a validated authorization.
type Token struct {
	Event      *nostr.Event
	Pubkey     string
	Verb       string
	Hashes     []string
	Expiration time.Time
}

// HasHash reports whether the token is scoped to hash.
func (t *Token) HasHash(hash string) bool {
	for _, h := range t.Hashes {
		if h == hash {
			return true
		}
	}
	return false
}

// Verifier checks tokens against the server's identity and clock.
type Verifier struct {
	// Hosts are the lowercase domain names that identify this server. A token
	// with "server" tags must name one of them.
	Hosts []string
	// MaxTTL bounds how far in the future a token may expire.
	MaxTTL time.Duration
	// Skew tolerates a client clock that is slightly ahead of the server.
	Skew time.Duration
	Now  func() time.Time

	used *onceCache
}

func NewVerifier(hosts []string, maxTTL, skew time.Duration) *Verifier {
	return &Verifier{Hosts: hosts, MaxTTL: maxTTL, Skew: skew, Now: time.Now, used: newOnceCache(10000)}
}

// Parse decodes and checks the structure, signature and time window of the
// Authorization header, then checks that the token's verb matches.
func (v *Verifier) Parse(header, verb string) (*Token, error) {
	if header == "" {
		return nil, unauthorized("missing Authorization header")
	}
	scheme, payload, ok := strings.Cut(header, " ")
	if !ok || !strings.EqualFold(scheme, "Nostr") {
		return nil, unauthorized("Authorization scheme must be Nostr")
	}
	payload = strings.TrimSpace(payload)
	if len(payload) > maxHeaderBytes {
		return nil, unauthorized("token too large")
	}
	raw, err := decodeBase64(payload)
	if err != nil {
		return nil, unauthorized("token is not valid base64url")
	}

	var ev nostr.Event
	if err := json.Unmarshal(raw, &ev); err != nil {
		return nil, unauthorized("token is not a valid event")
	}
	if ev.Kind != KindBlossomAuth {
		return nil, unauthorized("event kind must be %d", KindBlossomAuth)
	}
	if !isHex(ev.PubKey, 64) {
		return nil, unauthorized("malformed pubkey")
	}
	// CheckSignature hashes the serialised event, so a forged id field would
	// pass it. The id must be recomputed and compared explicitly.
	if ev.GetID() != ev.ID {
		return nil, unauthorized("event id does not match content")
	}
	if good, err := ev.CheckSignature(); err != nil || !good {
		return nil, unauthorized("invalid signature")
	}

	now := v.Now()
	created := time.Unix(int64(ev.CreatedAt), 0)
	if created.After(now.Add(v.Skew)) {
		return nil, unauthorized("created_at is in the future")
	}

	var (
		exp    time.Time
		hasExp bool
		verbs  []string
		hashes []string
		hosts  []string
	)
	for _, tag := range ev.Tags {
		if len(tag) < 2 {
			return nil, unauthorized("malformed tag")
		}
		switch tag[0] {
		case "expiration":
			secs, err := strconv.ParseInt(tag[1], 10, 64)
			if err != nil || secs <= 0 || hasExp {
				return nil, unauthorized("malformed expiration tag")
			}
			exp, hasExp = time.Unix(secs, 0), true
		case "t":
			verbs = append(verbs, tag[1])
		case "x":
			if !isHex(tag[1], 64) {
				return nil, unauthorized("malformed x tag")
			}
			hashes = append(hashes, tag[1])
		case "server":
			hosts = append(hosts, tag[1])
		}
	}

	if !hasExp {
		return nil, unauthorized("missing expiration tag")
	}
	if !exp.After(now) {
		return nil, unauthorized("token expired")
	}
	if exp.After(now.Add(v.MaxTTL)) {
		return nil, unauthorized("expiration is more than %s away", v.MaxTTL)
	}
	if len(verbs) != 1 {
		return nil, unauthorized("token must carry exactly one t tag")
	}
	if verbs[0] != verb {
		return nil, unauthorized("token is for %q, not %q", verbs[0], verb)
	}
	if len(hosts) > 0 && !v.matchesHost(hosts) {
		return nil, unauthorized("token is scoped to a different server")
	}

	return &Token{Event: &ev, Pubkey: ev.PubKey, Verb: verb, Hashes: hashes, Expiration: exp}, nil
}

// Authorize parses the request's token for verb. When hash is non-empty the
// token must carry a matching x tag.
func (v *Verifier) Authorize(r *http.Request, verb, hash string) (*Token, error) {
	t, err := v.Parse(r.Header.Get("Authorization"), verb)
	if err != nil {
		return nil, err
	}
	if hash != "" && !t.HasHash(hash) {
		return nil, unauthorized("token is not scoped to this blob")
	}
	return t, nil
}

// Consume marks a token as used. It returns false if the token was already
// consumed. Used for deletion, where replaying an old token after the same
// content was uploaded again would remove the new copy.
func (v *Verifier) Consume(t *Token) bool {
	return v.used.add(t.Event.ID, t.Expiration)
}

func (v *Verifier) matchesHost(hosts []string) bool {
	for _, h := range hosts {
		for _, mine := range v.Hosts {
			if h == mine {
				return true
			}
		}
	}
	return false
}

func decodeBase64(s string) ([]byte, error) {
	// BUD-11 specifies unpadded base64url. Padded and standard alphabets are
	// accepted because older Blossom clients produced them.
	for _, enc := range []*base64.Encoding{base64.RawURLEncoding, base64.URLEncoding, base64.StdEncoding, base64.RawStdEncoding} {
		if b, err := enc.DecodeString(s); err == nil {
			return b, nil
		}
	}
	return nil, errors.New("invalid base64")
}

func isHex(s string, n int) bool {
	if len(s) != n {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

// IsHash reports whether s is a lowercase hex SHA-256.
func IsHash(s string) bool { return isHex(s, 64) }

// onceCache remembers event ids until the token would have expired anyway.
type onceCache struct {
	mu   sync.Mutex
	max  int
	seen map[string]time.Time
}

func newOnceCache(max int) *onceCache { return &onceCache{max: max, seen: map[string]time.Time{}} }

func (c *onceCache) add(id string, until time.Time) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, dup := c.seen[id]; dup {
		return false
	}
	if len(c.seen) >= c.max {
		now := time.Now()
		for k, t := range c.seen {
			if t.Before(now) {
				delete(c.seen, k)
			}
		}
		if len(c.seen) >= c.max {
			return false // fail closed: refuse rather than forget live ids
		}
	}
	c.seen[id] = until
	return true
}
