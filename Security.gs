// Security.gs — guard terpusat. SETIAP fungsi publik yang dipanggil dari
// client (google.script.run) wajib mulai dengan salah satu fungsi di file
// ini. Ini perbaikan eksplisit atas SAG, yang menulis guard berulang-ulang
// per file tanpa satu titik pusat.

/**
 * Security_requireAuth_()
 * Pastikan user terautentikasi & terdaftar (role SUPERADMIN atau GURU).
 * Melempar Error dengan pesan berbahasa Indonesia yang aman ditampilkan
 * langsung ke user (bukan stack trace) — pola SAG yang dipertahankan.
 */
function Security_requireAuth_() {
  const auth = getAuth();
  if (!auth.authenticated || !auth.role) {
    throw new Error(auth.message || 'Akun belum terdaftar. Hubungi Superadmin.');
  }
  return auth;
}

/**
 * Security_requireRole_(allowedRoles)
 * allowedRoles: array, mis. ['GURU'] atau ['SUPERADMIN'] atau ['GURU','SUPERADMIN'].
 */
function Security_requireRole_(allowedRoles) {
  const auth = Security_requireAuth_();
  if (allowedRoles.indexOf(auth.role) === -1) {
    throw new Error('AKSES_DITOLAK: Anda tidak memiliki izin untuk aksi ini.');
  }
  return auth;
}

/**
 * Security_requireOwnership_(auth, ownerGuruId)
 * SUPERADMIN selalu lolos. GURU hanya lolos kalau ownerGuruId sama dengan
 * guru_id miliknya sendiri (hasil getAuth(), bukan dari parameter client).
 */
function Security_requireOwnership_(auth, ownerGuruId) {
  if (auth.role === 'SUPERADMIN') return;
  if (auth.role === 'GURU' && String(auth.guruId) === String(ownerGuruId)) return;
  throw new Error('AKSES_DITOLAK: Data ini bukan milik Anda.');
}
