// Package server implements the Blossom HTTP API.
package server

import (
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"sovereign-media-hub/internal/auth"
	"sovereign-media-hub/internal/config"
	"sovereign-media-hub/internal/db"
	"sovereign-media-hub/internal/store"
)

const Version = "2.0.0"

type Server struct {
	cfg     *config.Config
	db      *db.DB
	store   *store.Store
	auth    *auth.Verifier
	limiter *limiter
	log     *slog.Logger
}

func New(cfg *config.Config, d *db.DB, st *store.Store, log *slog.Logger) *Server {
	return &Server{
		cfg:     cfg,
		db:      d,
		store:   st,
		auth:    auth.NewVerifier(cfg.PublicHosts, cfg.MaxTokenTTL, cfg.ClockSkew),
		limiter: newLimiter(cfg.RateLimit, cfg.RateBurst),
		log:     log,
	}
}

// Verifier exposes the token verifier so tests can control its clock.
func (s *Server) Verifier() *auth.Verifier { return s.auth }

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", s.handleInfo)
	mux.HandleFunc("GET /info", s.handleInfo)
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("PUT /upload", s.limited(s.handleUpload))
	mux.HandleFunc("HEAD /upload", s.limited(s.handleUploadCheck))
	mux.HandleFunc("GET /list/{pubkey}", s.limited(s.handleList))
	mux.HandleFunc("GET /{blob}", s.handleGet)
	mux.HandleFunc("DELETE /{blob}", s.limited(s.handleDelete))

	return s.recoverer(s.logging(s.cors(mux)))
}

// reply writes a JSON body.
func reply(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// fail sends an error in both forms Blossom clients look at: the X-Reason
// header (BUD-01) and a small JSON body.
func fail(w http.ResponseWriter, status int, reason string) {
	w.Header().Set("X-Reason", reason)
	reply(w, status, map[string]any{"error": reason, "status": status})
}

func failAuth(w http.ResponseWriter, err error) {
	if ae, ok := err.(*auth.Error); ok {
		fail(w, ae.Status, ae.Reason)
		return
	}
	fail(w, http.StatusUnauthorized, "authorization failed")
}

func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Access-Control-Allow-Origin", "*")
		h.Set("Access-Control-Expose-Headers", "X-Reason, Content-Length, Content-Range, Accept-Ranges, ETag")
		h.Set("X-Content-Type-Options", "nosniff")
		if r.Method == http.MethodOptions {
			h.Set("Access-Control-Allow-Methods", "GET, HEAD, PUT, DELETE, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Content-Length, Range, X-SHA-256, X-Content-Type, X-Content-Length")
			h.Set("Access-Control-Max-Age", "86400")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (w *statusWriter) WriteHeader(code int) {
	if w.status == 0 {
		w.status = code
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(p []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	n, err := w.ResponseWriter.Write(p)
	w.bytes += int64(n)
	return n, err
}

// Unwrap lets http.ResponseController reach the underlying connection.
func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (s *Server) logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w}
		next.ServeHTTP(sw, r)
		s.log.Info("request",
			"method", r.Method, "path", r.URL.Path, "status", sw.status,
			"bytes", sw.bytes, "ms", time.Since(start).Milliseconds())
	})
}

func (s *Server) recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				s.log.Error("panic", "value", v, "stack", string(debug.Stack()))
				fail(w, http.StatusInternalServerError, "internal error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (s *Server) clientIP(r *http.Request) string {
	if s.cfg.TrustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			return strings.TrimSpace(parts[len(parts)-1])
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (s *Server) limited(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.limiter.allow(s.clientIP(r)) {
			w.Header().Set("Retry-After", "1")
			fail(w, http.StatusTooManyRequests, "rate limit exceeded")
			return
		}
		next(w, r)
	}
}

// limiter is a per-client token bucket.
type limiter struct {
	rate  float64
	burst float64
	mu    sync.Mutex
	m     map[string]*bucket
	calls int
}

type bucket struct {
	tokens float64
	last   time.Time
}

func newLimiter(rate float64, burst int) *limiter {
	return &limiter{rate: rate, burst: float64(burst), m: map[string]*bucket{}}
}

func (l *limiter) allow(key string) bool {
	if l.rate == 0 {
		return true
	}
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()

	if l.calls++; l.calls%1024 == 0 {
		for k, b := range l.m {
			if now.Sub(b.last) > time.Minute {
				delete(l.m, k)
			}
		}
	}
	b, ok := l.m[key]
	if !ok {
		b = &bucket{tokens: l.burst, last: now}
		l.m[key] = b
	}
	b.tokens += now.Sub(b.last).Seconds() * l.rate
	if b.tokens > l.burst {
		b.tokens = l.burst
	}
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}
