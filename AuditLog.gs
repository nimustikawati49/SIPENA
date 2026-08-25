// AuditLog.gs — pencatatan aksi administratif ke sheet central AUDIT_LOG.
// Dipanggil dari modul admin (Sekolah/Guru/Mapel/Kelas/Penugasan/dst.)
// setelah aksi tulis berhasil. Tidak pernah throw — gagal mencatat audit
// tidak boleh menggagalkan aksi utama.

function AuditLog_write_(auth, action, module, recordId, description) {
  try {
    const sh = Config_getSheet_('AUDIT_LOG');
    Utils_appendRowByHeader_(sh, {
      timestamp: new Date(),
      email: auth && auth.email ? auth.email : '',
      guru_id: auth && auth.guruId ? auth.guruId : '',
      sekolah_id: auth && auth.sekolahId ? auth.sekolahId : '',
      action: action,
      module: module,
      record_id: recordId,
      description: description || ''
    });
  } catch (e) {
    try { Utils_logError_('AUDIT_LOG_WRITE', e); } catch (e2) {}
  }
}

/**
 * getAuditLog(limit)
 * SUPERADMIN only. Baca N baris terakhir (default 100) — tidak pernah
 * load seluruh log tanpa batas.
 */
function getAuditLog(limit) {
  Security_requireRole_(['SUPERADMIN']);
  const sh = Config_getSheet_('AUDIT_LOG');
  const rows = Utils_sheetToObjects_(sh);
  const n = Math.min(limit || 100, 300);
  return rows.slice(Math.max(0, rows.length - n)).reverse();
}
