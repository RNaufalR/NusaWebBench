// Fixture sintetis: sengaja memicu error konsol dan request gagal untuk uji ground truth.
// Tidak ada data nyata; tidak ada kunci atau token.
console.error('nwb-fixture: error konsol yang diharapkan');
document.getElementById('load-btn')?.addEventListener('click', () => {
  fetch('/api/missing-resource')
    .then((r) => {
      document.getElementById('status').textContent = `Status ${r.status}`;
    })
    .catch(() => {
      document.getElementById('status').textContent = 'Gagal';
    });
});
throw new Error('nwb-fixture: uncaught page error yang diharapkan');
