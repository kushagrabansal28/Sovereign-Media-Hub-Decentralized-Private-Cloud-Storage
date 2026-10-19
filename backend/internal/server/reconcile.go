package server

import (
	"log/slog"

	"sovereign-media-hub/internal/db"
	"sovereign-media-hub/internal/store"
)

// Reconcile compares the database with the files on disk after a restart.
//
//   - A file with no database row has no owner and is not served. A crash between
//     the final rename and the database commit leaves one, and so does restoring
//     an older database backup. Files are never deleted here: the next upload of
//     the same bytes adopts the file, and the count is logged so an operator can
//     notice a mismatched restore.
//   - A database row with no file would make a listed blob answer 404. The row is
//     dropped so the owner can upload it again.
func Reconcile(d *db.DB, s *store.Store, log *slog.Logger) error {
	rows, err := d.All()
	if err != nil {
		return err
	}
	known := make(map[string]struct{}, len(rows))
	for _, b := range rows {
		known[b.SHA256] = struct{}{}
	}

	onDisk := map[string]struct{}{}
	unreferenced := 0
	if err := s.Walk(func(hash string, _ int64) error {
		onDisk[hash] = struct{}{}
		if _, ok := known[hash]; !ok {
			unreferenced++
		}
		return nil
	}); err != nil {
		return err
	}
	if unreferenced > 0 {
		log.Warn("blob files without a database row were left in place", "count", unreferenced)
	}
	for _, b := range rows {
		if _, ok := onDisk[b.SHA256]; !ok {
			if err := d.Purge(b.SHA256); err != nil {
				return err
			}
			log.Warn("dropped database row without a file", "sha256", b.SHA256)
		}
	}
	return nil
}
