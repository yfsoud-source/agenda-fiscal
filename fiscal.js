const p = n => String(n).padStart(2, '0'), L = (y, m) => new Date(y, m, 0).getDate();
const ALL = [1,2,3,4,5,6,7,8,9,10,11,12], TR = [1,4,7,10];
const AN = {
  bilan: ['Bilan – Liasse fiscale IS', [3]], e9421: ['État 9421', [1]], tp: ['Taxe professionnelle', [1]],
  tsc: ['Taxe de services communaux', [3]], timbre: ['Droit de timbre', [3]], honoraires: ['État des honoraires', [1]]
};
function regles(s) {
  const o = s.ob || {}, r = [], A = (t, l, ms, d) => r.push({ t, l, ms, d });
  if (o.tva === 'm') A('TVA', 'TVA mensuelle', ALL, 'L');
  if (o.tva === 't') A('TVA', 'TVA trimestrielle', TR, 'L');
  if (o.delai === 'm') A('Délais de paiement', 'Délais de paiement mensuel', ALL, 'L');
  if (o.delai === 't') A('Délais de paiement', 'Délais de paiement trimestriel', TR, 'L');
  if (o.cnss) A('CNSS', 'CNSS – Damancom', ALL, 10);
  if (o.ir) A('IR', 'IR salarial (retenue à la source)', ALL, 'L');
  if (o.is) [3, 6, 9, 12].forEach((m, i) => A('IS', 'IS – Acompte n°' + (i + 1), [m], 'L'));
  for (const k in AN) if (o.annuel && o.annuel[k]) A('Annuel', AN[k][0], AN[k][1], 'L');
  (o.perso || []).forEach(c => A('Personnalisé', c.nom, c.per === 'm' ? ALL : c.per === 't' ? TR : [+c.mois || 1], +c.jour || 1));
  return r;
}
// Échéances du mois précédent + 12 mois à venir pour chaque société
function echeances(socs, now) {
  const out = [], y0 = now.getFullYear(), m0 = now.getMonth();
  for (const s of socs || []) for (const r of regles(s)) for (let k = -1; k < 12; k++) {
    const dt = new Date(y0, m0 + k, 1), y = dt.getFullYear(), m = dt.getMonth() + 1;
    if (!r.ms.includes(m)) continue;
    const d = r.d === 'L' ? L(y, m) : Math.min(r.d, L(y, m)), date = `${y}-${p(m)}-${p(d)}`;
    out.push({ key: `${s.id}|${r.l}|${date}`, sid: s.id, nom: s.nom, couleur: s.couleur, type: r.t, label: r.l, date });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
const diff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 864e5);
module.exports = { echeances, diff };
