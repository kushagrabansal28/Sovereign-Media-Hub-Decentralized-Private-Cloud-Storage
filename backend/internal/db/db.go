// Package db keeps blob metadata and ownership in SQLite.
package db

import (
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"time"

	_ "modernc.org/sqlite"
)

// Blob is one stored object.
type Blob struct {
	SHA256    string
	Size      int64
	MIME      string
	CreatedAt int64
}

// Owned is a blob as seen by one owner.
type Owned struct {
	Blob
	Uploaded int64
}

type DB struct{ sql *sql.DB }

// Open opens or creates the database. The pragmas use the modernc driver's
// `_pragma` syntax; the `_journal_mode=` style used by other drivers is ignored.
func Open(path string) (*DB, error) {
	q := url.Values{}
	q.Add("_pragma", "journal_mode(WAL)")
	q.Add("_pragma", "busy_timeout(5000)")
	q.Add("_pragma", "foreign_keys(1)")
	q.Add("_pragma", "synchronous(NORMAL)")
	dsn := (&url.URL{Scheme: "file", Opaque: filepathToURI(path), RawQuery: q.Encode()}).String()

	s, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	s.SetMaxOpenConns(4)
	if err := s.Ping(); err != nil {
		s.Close()
		return nil, err
	}
	d := &DB{sql: s}
	if err := d.migrate(); err != nil {
		s.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return d, nil
}

func filepathToURI(p string) string {
	// Windows drive paths need a leading slash inside a file: URI.
	if len(p) > 1 && p[1] == ':' {
		p = "/" + p
	}
	out := make([]byte, 0, len(p))
	for i := 0; i < len(p); i++ {
		c := p[i]
		switch c {
		case '\\':
			out = append(out, '/')
		case '?', '#', '%':
			out = append(out, []byte(fmt.Sprintf("%%%02X", c))...)
		default:
			out = append(out, c)
		}
	}
	return string(out)
}

func (d *DB) Close() error { return d.sql.Close() }

func (d *DB) Ping() error { return d.sql.Ping() }

func (d *DB) migrate() error {
	_, err := d.sql.Exec(`
CREATE TABLE IF NOT EXISTS blobs (
	sha256     TEXT PRIMARY KEY CHECK (length(sha256) = 64),
	size       INTEGER NOT NULL CHECK (size >= 0),
	mime       TEXT NOT NULL,
	created_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS owners (
	pubkey   TEXT NOT NULL CHECK (length(pubkey) = 64),
	sha256   TEXT NOT NULL REFERENCES blobs(sha256) ON DELETE CASCADE,
	uploaded INTEGER NOT NULL,
	PRIMARY KEY (pubkey, sha256)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS owners_by_time ON owners (pubkey, uploaded DESC, sha256 DESC);
CREATE INDEX IF NOT EXISTS owners_by_blob ON owners (sha256);
`)
	return err
}

// Record stores the blob if it is new and links it to owner. It reports
// whether the blob row was created. Linking the same owner twice is a no-op
// and keeps the original upload time.
func (d *DB) Record(owner string, b Blob) (created bool, err error) {
	tx, err := d.sql.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	now := time.Now().Unix()
	res, err := tx.Exec(`INSERT OR IGNORE INTO blobs (sha256, size, mime, created_at) VALUES (?, ?, ?, ?)`,
		b.SHA256, b.Size, b.MIME, now)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	created = n == 1
	if _, err := tx.Exec(`INSERT OR IGNORE INTO owners (pubkey, sha256, uploaded) VALUES (?, ?, ?)`,
		owner, b.SHA256, now); err != nil {
		return false, err
	}
	return created, tx.Commit()
}

// Get returns a blob row, or sql.ErrNoRows.
func (d *DB) Get(sha string) (Blob, error) {
	var b Blob
	err := d.sql.QueryRow(`SELECT sha256, size, mime, created_at FROM blobs WHERE sha256 = ?`, sha).
		Scan(&b.SHA256, &b.Size, &b.MIME, &b.CreatedAt)
	return b, err
}

var ErrNotOwner = errors.New("not an owner of this blob")

// Unlink removes owner's claim on a blob. It returns the number of owners that
// remain. When none remain the blob row is deleted too and the caller must
// remove the file.
func (d *DB) Unlink(owner, sha string) (remaining int, err error) {
	tx, err := d.sql.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	res, err := tx.Exec(`DELETE FROM owners WHERE pubkey = ? AND sha256 = ?`, owner, sha)
	if err != nil {
		return 0, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return 0, ErrNotOwner
	}
	if err := tx.QueryRow(`SELECT COUNT(*) FROM owners WHERE sha256 = ?`, sha).Scan(&remaining); err != nil {
		return 0, err
	}
	if remaining == 0 {
		if _, err := tx.Exec(`DELETE FROM blobs WHERE sha256 = ?`, sha); err != nil {
			return 0, err
		}
	}
	return remaining, tx.Commit()
}

// ListQuery selects a page of an owner's blobs, newest first.
type ListQuery struct {
	Owner  string
	Cursor string // sha256 of the last item of the previous page
	Limit  int
	Since  int64
	Until  int64 // 0 means no upper bound
}

func (d *DB) List(q ListQuery) ([]Owned, error) {
	args := []any{q.Owner}
	where := `o.pubkey = ?`
	if q.Cursor != "" {
		var up int64
		err := d.sql.QueryRow(`SELECT uploaded FROM owners WHERE pubkey = ? AND sha256 = ?`, q.Owner, q.Cursor).Scan(&up)
		if errors.Is(err, sql.ErrNoRows) {
			return []Owned{}, nil
		} else if err != nil {
			return nil, err
		}
		where += ` AND (o.uploaded, o.sha256) < (?, ?)`
		args = append(args, up, q.Cursor)
	}
	if q.Since > 0 {
		where += ` AND o.uploaded >= ?`
		args = append(args, q.Since)
	}
	if q.Until > 0 {
		where += ` AND o.uploaded <= ?`
		args = append(args, q.Until)
	}
	args = append(args, q.Limit)

	rows, err := d.sql.Query(`
SELECT b.sha256, b.size, b.mime, b.created_at, o.uploaded
FROM owners o JOIN blobs b ON b.sha256 = o.sha256
WHERE `+where+` ORDER BY o.uploaded DESC, o.sha256 DESC LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Owned{}
	for rows.Next() {
		var o Owned
		if err := rows.Scan(&o.SHA256, &o.Size, &o.MIME, &o.CreatedAt, &o.Uploaded); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// All returns every blob row. Used at startup to reconcile with the disk.
func (d *DB) All() ([]Blob, error) {
	rows, err := d.sql.Query(`SELECT sha256, size, mime, created_at FROM blobs`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Blob
	for rows.Next() {
		var b Blob
		if err := rows.Scan(&b.SHA256, &b.Size, &b.MIME, &b.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// Purge deletes a blob row and its owners (used when the file is gone).
func (d *DB) Purge(sha string) error {
	_, err := d.sql.Exec(`DELETE FROM blobs WHERE sha256 = ?`, sha)
	return err
}

// Totals reports row counts and logical sizes for diagnostics.
func (d *DB) Totals() (blobs int, bytes int64, err error) {
	err = d.sql.QueryRow(`SELECT COUNT(*), COALESCE(SUM(size), 0) FROM blobs`).Scan(&blobs, &bytes)
	return
}

// Pragma reads a pragma value; used by tests to confirm settings took effect.
func (d *DB) Pragma(name string) (string, error) {
	var v string
	err := d.sql.QueryRow("PRAGMA " + name).Scan(&v)
	return v, err
}

// Exec runs a statement directly. It exists for tests and one-off maintenance;
// request handlers use the typed methods above.
func (d *DB) Exec(query string, args ...any) error {
	_, err := d.sql.Exec(query, args...)
	return err
}
