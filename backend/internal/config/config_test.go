package config

import (
	"strings"
	"testing"
)

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

const pk = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"

func TestDefaults(t *testing.T) {
	c, err := Load(env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if c.Port != "8787" || c.BaseURL != "http://localhost:8787" || c.MaxUploadBytes != 104857600 || len(c.AllowedPubkeys) != 0 {
		t.Fatalf("%+v", c)
	}
	if len(c.PublicHosts) != 1 || c.PublicHosts[0] != "localhost" {
		t.Fatalf("hosts %v", c.PublicHosts)
	}
}

func TestPublicHostsDeriveFromBaseURL(t *testing.T) {
	c, err := Load(env(map[string]string{"BASE_URL": "https://Media.Example.org:8443/", "PUBLIC_HOSTS": "alias.example.org, "}))
	if err != nil {
		t.Fatal(err)
	}
	if c.BaseURL != "https://Media.Example.org:8443" || strings.Join(c.PublicHosts, ",") != "media.example.org,alias.example.org" {
		t.Fatalf("%q %v", c.BaseURL, c.PublicHosts)
	}
}

func TestAllowedPubkeysAcceptHexAndNpub(t *testing.T) {
	c, err := Load(env(map[string]string{"ALLOWED_PUBKEYS": pk + ",npub10xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqpkge6d"}))
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := c.AllowedPubkeys[pk]; !ok || len(c.AllowedPubkeys) != 1 {
		t.Fatalf("%v", c.AllowedPubkeys)
	}
}

func TestInvalidValuesAreRejected(t *testing.T) {
	for k, v := range map[string]string{
		"BASE_URL":              "ftp://x",
		"MAX_FILE_SIZE":         "-1",
		"ALLOWED_PUBKEYS":       "not-a-key",
		"RATE_LIMIT_PER_SECOND": "fast",
		"MAX_TOKEN_TTL_SECONDS": "0",
	} {
		if _, err := Load(env(map[string]string{k: v})); err == nil {
			t.Errorf("%s=%q accepted", k, v)
		}
	}
}
