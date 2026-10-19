package media

import "testing"

func pad(b []byte) []byte { return append(b, make([]byte, SniffLen)...) }

func TestSniff(t *testing.T) {
	ftyp := func(brand string) []byte { return pad(append([]byte{0, 0, 0, 0x18, 'f', 't', 'y', 'p'}, brand...)) }
	cases := []struct {
		name string
		in   []byte
		want Type
		ok   bool
	}{
		{"jpeg", pad([]byte{0xFF, 0xD8, 0xFF, 0xE0}), JPEG, true},
		{"png", pad([]byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}), PNG, true},
		{"gif89", pad([]byte("GIF89a")), GIF, true},
		{"webp", pad([]byte("RIFF\x00\x00\x00\x00WEBP")), WebP, true},
		{"avif", ftyp("avif"), AVIF, true},
		{"mp4", ftyp("isom"), MP4, true},
		{"mov", ftyp("qt  "), QuickTime, true},
		{"webm", pad([]byte{0x1A, 0x45, 0xDF, 0xA3}), WebM, true},
		{"wav is not webp", pad([]byte("RIFF\x00\x00\x00\x00WAVE")), Type{}, false},
		{"heic", ftyp("heic"), Type{}, false},
		{"m4a audio", ftyp("M4A "), Type{}, false},
		{"html", pad([]byte("<html>")), Type{}, false},
		{"svg", pad([]byte("<svg ")), Type{}, false},
		{"empty", nil, Type{}, false},
	}
	for _, c := range cases {
		got, ok := Sniff(c.in)
		if ok != c.ok || got != c.want {
			t.Errorf("%s: got %v %v, want %v %v", c.name, got, ok, c.want, c.ok)
		}
	}
}

func TestExtensionsRoundTrip(t *testing.T) {
	for _, m := range Allowed() {
		ext := ExtForMIME(m)
		if ext == "" {
			t.Fatalf("no extension for %s", m)
		}
		if got, ok := ByExt(ext); !ok || got.MIME != m {
			t.Errorf("ByExt(%q) = %v", ext, got)
		}
	}
}
