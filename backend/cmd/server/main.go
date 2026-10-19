package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"sovereign-media-hub/internal/config"
	"sovereign-media-hub/internal/db"
	"sovereign-media-hub/internal/server"
	"sovereign-media-hub/internal/store"
)

func main() {
	healthcheck := flag.Bool("healthcheck", false, "request /health on the local server and exit 0 if it answers")
	scrub := flag.Bool("scrub", false, "re-hash every stored blob, report mismatches and exit")
	flag.Parse()

	log := slog.New(slog.NewTextHandler(os.Stderr, nil))

	cfg, err := config.FromOS()
	if err != nil {
		log.Error("configuration", "err", err)
		os.Exit(2)
	}
	if *healthcheck {
		os.Exit(probe(cfg.Port))
	}

	if err := os.MkdirAll(cfg.DataDir, 0o750); err != nil {
		log.Error("data dir", "err", err)
		os.Exit(1)
	}
	database, err := db.Open(filepath.Join(cfg.DataDir, "sovereign.db"))
	if err != nil {
		log.Error("database", "err", err)
		os.Exit(1)
	}
	defer database.Close()
	blobs, err := store.Open(cfg.DataDir)
	if err != nil {
		log.Error("blob store", "err", err)
		os.Exit(1)
	}

	if *scrub {
		os.Exit(runScrub(blobs, log))
	}
	if err := server.Reconcile(database, blobs, log); err != nil {
		log.Error("reconcile", "err", err)
		os.Exit(1)
	}

	policy := "open (any valid key may upload)"
	if len(cfg.AllowedPubkeys) > 0 {
		policy = fmt.Sprintf("allow-list (%d keys)", len(cfg.AllowedPubkeys))
	}
	log.Info("starting", "version", server.Version, "port", cfg.Port, "base_url", cfg.BaseURL,
		"max_upload_bytes", cfg.MaxUploadBytes, "upload_policy", policy)

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           server.New(cfg, database, blobs, log).Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		srv.Shutdown(shutdown)
	}()

	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Error("server", "err", err)
		os.Exit(1)
	}
	log.Info("stopped")
}

func probe(port string) int {
	c := http.Client{Timeout: 3 * time.Second}
	resp, err := c.Get("http://127.0.0.1:" + port + "/health")
	if err != nil {
		return 1
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}

func runScrub(blobs *store.Store, log *slog.Logger) int {
	bad, total := 0, 0
	err := blobs.Walk(func(hash string, _ int64) error {
		total++
		if err := blobs.Verify(hash); err != nil {
			bad++
			log.Error("corrupt blob", "sha256", hash, "err", err)
		}
		return nil
	})
	if err != nil {
		log.Error("scrub", "err", err)
		return 1
	}
	log.Info("scrub finished", "checked", total, "corrupt", bad)
	if bad > 0 {
		return 1
	}
	return 0
}
