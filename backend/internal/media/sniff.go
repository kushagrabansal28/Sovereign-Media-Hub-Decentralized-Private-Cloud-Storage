// Package media identifies the file types the server is willing to store.
package media

import "bytes"

// Type is a recognised, allowed media type.
type Type struct {
	MIME string
	Ext  string // without the dot
}

var (
	JPEG      = Type{"image/jpeg", "jpg"}
	PNG       = Type{"image/png", "png"}
	GIF       = Type{"image/gif", "gif"}
	WebP      = Type{"image/webp", "webp"}
	AVIF      = Type{"image/avif", "avif"}
	MP4       = Type{"video/mp4", "mp4"}
	QuickTime = Type{"video/quicktime", "mov"}
	WebM      = Type{"video/webm", "webm"}
)

// SniffLen is the number of leading bytes Sniff needs.
const SniffLen = 32

// Sniff identifies a file from its leading bytes. It returns false for anything
// that is not an allowed image or video, including SVG, HTML and audio.
func Sniff(head []byte) (Type, bool) {
	switch {
	case bytes.HasPrefix(head, []byte{0xFF, 0xD8, 0xFF}):
		return JPEG, true
	case bytes.HasPrefix(head, []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}):
		return PNG, true
	case bytes.HasPrefix(head, []byte("GIF87a")), bytes.HasPrefix(head, []byte("GIF89a")):
		return GIF, true
	case len(head) >= 12 && bytes.Equal(head[0:4], []byte("RIFF")) && bytes.Equal(head[8:12], []byte("WEBP")):
		return WebP, true
	case bytes.HasPrefix(head, []byte{0x1A, 0x45, 0xDF, 0xA3}):
		return WebM, true
	case len(head) >= 12 && bytes.Equal(head[4:8], []byte("ftyp")):
		switch string(head[8:12]) {
		case "avif", "avis":
			return AVIF, true
		case "qt  ":
			return QuickTime, true
		case "isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "dash":
			return MP4, true
		}
	}
	return Type{}, false
}

// ByExt returns the type for a URL extension such as "jpg" or "mp4".
func ByExt(ext string) (Type, bool) {
	for _, t := range []Type{JPEG, PNG, GIF, WebP, AVIF, MP4, QuickTime, WebM} {
		if t.Ext == ext {
			return t, true
		}
	}
	return Type{}, false
}

// ExtForMIME returns the URL extension for a stored MIME type.
func ExtForMIME(mime string) string {
	for _, t := range []Type{JPEG, PNG, GIF, WebP, AVIF, MP4, QuickTime, WebM} {
		if t.MIME == mime {
			return t.Ext
		}
	}
	return ""
}

// Allowed lists the MIME types the server accepts.
func Allowed() []string {
	return []string{
		JPEG.MIME, PNG.MIME, GIF.MIME, WebP.MIME, AVIF.MIME,
		MP4.MIME, QuickTime.MIME, WebM.MIME,
	}
}
