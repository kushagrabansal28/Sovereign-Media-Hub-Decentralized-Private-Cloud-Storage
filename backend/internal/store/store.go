// Package store keeps blob bytes on disk under their SHA-256.
//
// Layout: <root>/blobs/ab/cd/<sha256>. Uploads stream into <root>/tmp, which
// is on the same filesystem, and are renamed into place once the hash is known.
package store

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"sovereign-media-hub/internal/media"
)

var (
	ErrTooLarge        = errors.New("blob exceeds the size limit")
	ErrUnsupportedType = errors.New("unsupported media type")
	ErrBadHash         = errors.New("malformed sha256")
	ErrNotFound        = errors.New("blob not found")
)

const lockStripes = 256

type Store struct {
	blobs string
	tmp   string
	locks [lockStripes]sync.Mutex
}

func Open(root string) (*Store, error) {
	s := &Store{blobs: filepath.Join(root, "blobs"), tmp: filepath.Join(root, "tmp")}
	for _, d := range []string{s.blobs, s.tmp} {
		if err := os.MkdirAll(d, 0o750); err != nil {
			return nil, err
		}
	}
	// Nothing can be in flight at startup, so leftovers belong to crashed uploads.
	entries, err := os.ReadDir(s.tmp)
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		os.Remove(filepath.Join(s.tmp, e.Name()))
	}
	return s, nil
}

// Result describes a stored blob.
type Result struct {
	SHA256 string
	Size   int64
	Type   media.Type
}

// Staged is a fully received, hashed and type-checked upload that has not been
// committed yet.
type Staged struct {
	Result
	path string
	s    *Store
}

// Discard removes the staged file. Safe to call after Commit.
func (st *Staged) Discard() {
	if st.path != "" {
		os.Remove(st.path)
		st.path = ""
	}
}

// Stage reads r to a temporary file while hashing it. It stops early if the
// leading bytes are not an allowed media type or if more than max bytes arrive.
// The caller decides, based on the computed hash, whether to Commit.
func (s *Store) Stage(r io.Reader, max int64) (*Staged, error) {
	br := bufio.NewReaderSize(r, 64*1024)
	head, err := br.Peek(media.SniffLen)
	if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, bufio.ErrBufferFull) {
		return nil, err
	}
	typ, ok := media.Sniff(head)
	if !ok {
		return nil, ErrUnsupportedType
	}

	f, err := os.CreateTemp(s.tmp, "upload-*")
	if err != nil {
		return nil, err
	}
	path := f.Name()
	fail := func(e error) (*Staged, error) {
		f.Close()
		os.Remove(path)
		return nil, e
	}

	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(f, h), io.LimitReader(br, max+1))
	if err != nil {
		return fail(err)
	}
	if n > max {
		return fail(ErrTooLarge)
	}
	if err := f.Sync(); err != nil {
		return fail(err)
	}
	if err := f.Close(); err != nil {
		os.Remove(path)
		return nil, err
	}
	return &Staged{
		Result: Result{SHA256: hex.EncodeToString(h.Sum(nil)), Size: n, Type: typ},
		path:   path,
		s:      s,
	}, nil
}

// Commit moves the staged file to its final path. If the blob is already
// present the staged copy is dropped. It must be called with the hash lock held
// (see WithLock) so that it cannot interleave with a delete.
func (st *Staged) Commit() (existed bool, err error) {
	if st.path == "" {
		return false, errors.New("staged upload already finished")
	}
	final, err := st.s.path(st.SHA256)
	if err != nil {
		return false, err
	}
	if _, err := os.Stat(final); err == nil {
		st.Discard()
		return true, nil
	}
	if err := os.MkdirAll(filepath.Dir(final), 0o750); err != nil {
		return false, err
	}
	if err := os.Rename(st.path, final); err != nil {
		return false, err
	}
	st.path = ""
	return false, nil
}

// WithLock runs fn while holding the lock for hash. Uploads commit and deletes
// remove under the same lock, so a blob cannot be deleted between an upload's
// duplicate check and its ownership record.
func (s *Store) WithLock(hash string, fn func() error) error {
	if !validHash(hash) {
		return ErrBadHash
	}
	mu := &s.locks[hexVal(hash[0])<<4|hexVal(hash[1])]
	mu.Lock()
	defer mu.Unlock()
	return fn()
}

// Open opens a blob for reading.
func (s *Store) Open(hash string) (*os.File, error) {
	p, err := s.path(hash)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(p)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, ErrNotFound
	}
	return f, err
}

// Exists reports whether the blob file is present.
func (s *Store) Exists(hash string) bool {
	p, err := s.path(hash)
	if err != nil {
		return false
	}
	_, err = os.Stat(p)
	return err == nil
}

// Remove deletes the blob file. Missing files are not an error.
func (s *Store) Remove(hash string) error {
	p, err := s.path(hash)
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}

// Verify re-hashes the stored bytes and compares them with the name.
func (s *Store) Verify(hash string) error {
	f, err := s.Open(hash)
	if err != nil {
		return err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return err
	}
	if got := hex.EncodeToString(h.Sum(nil)); got != hash {
		return fmt.Errorf("stored bytes hash to %s, expected %s", got, hash)
	}
	return nil
}

// Walk calls fn for every blob file name found on disk.
func (s *Store) Walk(fn func(hash string, size int64) error) error {
	return filepath.WalkDir(s.blobs, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		if !validHash(d.Name()) {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		return fn(d.Name(), info.Size())
	})
}

func (s *Store) path(hash string) (string, error) {
	if !validHash(hash) {
		return "", ErrBadHash
	}
	return filepath.Join(s.blobs, hash[0:2], hash[2:4], hash), nil
}

func hexVal(c byte) int {
	if c >= 'a' {
		return int(c-'a') + 10
	}
	return int(c - '0')
}

func validHash(h string) bool {
	if len(h) != 64 {
		return false
	}
	for i := 0; i < len(h); i++ {
		c := h[i]
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return !strings.ContainsAny(h, `/\.`)
}
