// api/reativar-plano.js — reprocessa assinatura MP e ativa plano do usuário
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function isAdmin(req){ return req.headers['x-admin-password'] === process.env.ADMIN_PASSWORD; }

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!isAdmin(req)) return res.status(401).json({ error: 'Senha ADM incorreta' });

  const { preapproval_id, usuario_id, plano } = req.body;

  // ── Modo 1: busca pelo preapproval_id no MP ───────────────────────────────
  if (preapproval_id) {
    const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${preapproval_id}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` }
    });
    const pa = await mpRes.json();

    if (pa.status !== 'authorized') {
      return res.status(400).json({ error: `Preapproval não autorizado. Status: ${pa.status}` });
    }

    let ref;
    try { ref = JSON.parse(pa.external_reference); } catch { ref = null; }
    if (!ref?.usuario_id || !ref?.plano) {
      return res.status(400).json({ error: 'external_reference inválido no preapproval' });
    }

    await supabase.from('usuarios').update({ plano: ref.plano }).eq('id', ref.usuario_id);
    await supabase.from('pagamentos').upsert({
      usuario_id: ref.usuario_id, plano: ref.plano,
      mp_payment_id: preapproval_id, mp_status: 'approved',
      valor: pa.auto_recurring?.transaction_amount || 0
    }, { onConflict: 'mp_payment_id' });

    return res.status(200).json({ ok: true, msg: `Plano ${ref.plano} ativado para ${ref.usuario_id}` });
  }

  // ── Modo 2: ativa direto pelo usuario_id + plano (ADM manual) ────────────
  if (usuario_id && plano) {
    const PLANOS_VALIDOS = ['ferreiro','libaneo','vygotsky','piaget'];
    if (!PLANOS_VALIDOS.includes(plano)) return res.status(400).json({ error: 'Plano inválido' });

    await supabase.from('usuarios').update({ plano }).eq('id', usuario_id);
    await supabase.from('pagamentos').upsert({
      usuario_id, plano, mp_payment_id: `manual_${Date.now()}`,
      mp_status: 'approved', valor: 0
    }, { onConflict: 'mp_payment_id' });

    return res.status(200).json({ ok: true, msg: `Plano ${plano} ativado manualmente para ${usuario_id}` });
  }

  return res.status(400).json({ error: 'Informe preapproval_id OU usuario_id + plano' });
};
