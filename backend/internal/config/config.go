// Package config reads server settings from the environment.
package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/nbd-wtf/go-nostr/nip19"
)

type Config struct {
	Port           string
	DataDir        string
	BaseURL        string
	PublicHosts    []string
	MaxUploadBytes int64
	AllowedPubkeys map[string]struct{}
	MaxTokenTTL    time.Duration
	ClockSkew      time.Duration
	TrustProxy     bool
	RateLimit      float64 // write requests per second per client
	RateBurst      int
}

// Load reads the configuration. Unset variables fall back to development defaults.
func Load(getenv func(string) string) (*Config, error) {
	get := func(key, def string) string {
		if v := strings.TrimSpace(getenv(key)); v != "" {
			return v
		}
		return def
	}

	c := &Config{
		Port:    get("PORT", "8787"),
		DataDir: get("DATA_DIR", "./data"),
	}
	c.BaseURL = strings.TrimRight(get("BASE_URL", "http://localhost:"+c.Port), "/")

	u, err := url.Parse(c.BaseURL)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return nil, fmt.Errorf("BASE_URL %q is not an http(s) URL", c.BaseURL)
	}

	c.PublicHosts = []string{strings.ToLower(u.Hostname())}
	for _, h := range strings.Split(getenv("PUBLIC_HOSTS"), ",") {
		if h = strings.ToLower(strings.TrimSpace(h)); h != "" {
			c.PublicHosts = append(c.PublicHosts, h)
		}
	}

	if c.MaxUploadBytes, err = parseInt(get("MAX_FILE_SIZE", "104857600")); err != nil || c.MaxUploadBytes <= 0 {
		return nil, fmt.Errorf("MAX_FILE_SIZE must be a positive integer")
	}

	ttl, err := parseInt(get("MAX_TOKEN_TTL_SECONDS", "3600"))
	if err != nil || ttl <= 0 {
		return nil, fmt.Errorf("MAX_TOKEN_TTL_SECONDS must be a positive integer")
	}
	c.MaxTokenTTL = time.Duration(ttl) * time.Second

	skew, err := parseInt(get("CLOCK_SKEW_SECONDS", "60"))
	if err != nil || skew < 0 {
		return nil, fmt.Errorf("CLOCK_SKEW_SECONDS must be a non-negative integer")
	}
	c.ClockSkew = time.Duration(skew) * time.Second

	c.TrustProxy = get("TRUST_PROXY", "false") == "true"

	rl, err := strconv.ParseFloat(get("RATE_LIMIT_PER_SECOND", "5"), 64)
	if err != nil || rl < 0 {
		return nil, fmt.Errorf("RATE_LIMIT_PER_SECOND must be a non-negative number")
	}
	c.RateLimit = rl
	burst, err := parseInt(get("RATE_LIMIT_BURST", "30"))
	if err != nil || burst <= 0 {
		return nil, fmt.Errorf("RATE_LIMIT_BURST must be a positive integer")
	}
	c.RateBurst = int(burst)

	c.AllowedPubkeys = map[string]struct{}{}
	for _, raw := range strings.Split(getenv("ALLOWED_PUBKEYS"), ",") {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		pk, err := ParsePubkey(raw)
		if err != nil {
			return nil, fmt.Errorf("ALLOWED_PUBKEYS: %w", err)
		}
		c.AllowedPubkeys[pk] = struct{}{}
	}
	return c, nil
}

// ParsePubkey accepts a 64-character lowercase hex key or an npub.
func ParsePubkey(s string) (string, error) {
	if strings.HasPrefix(s, "npub1") {
		prefix, v, err := nip19.Decode(s)
		if err != nil || prefix != "npub" {
			return "", fmt.Errorf("invalid npub %q", s)
		}
		hex, ok := v.(string)
		if !ok {
			return "", fmt.Errorf("invalid npub %q", s)
		}
		return hex, nil
	}
	if len(s) != 64 || strings.ToLower(s) != s {
		return "", fmt.Errorf("public key must be 64 lowercase hex characters or an npub")
	}
	for _, r := range s {
		if !(r >= '0' && r <= '9' || r >= 'a' && r <= 'f') {
			return "", fmt.Errorf("public key must be 64 lowercase hex characters or an npub")
		}
	}
	return s, nil
}

func parseInt(s string) (int64, error) { return strconv.ParseInt(s, 10, 64) }

// FromOS loads configuration from the process environment.
func FromOS() (*Config, error) { return Load(os.Getenv) }
