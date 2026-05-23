const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { type, data } = req.body;

    if (type === 'subscription_preapproval') {
      const preapprovalId = data?.id;
      if (!preapprovalId) return res.status(400).end();

      // Busca detalhes da assinatura no MP
      const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
        headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` }
      });
      const mp = await mpRes.json();

      const status = mp.status; // authorized | paused | cancelled

      // Atualiza assinatura no Supabase
      await supabase
        .from('assinaturas')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('mp_preapproval_id', preapprovalId);

      // Se autorizado, marca user como PRO
      if (status === 'authorized') {
        const { data: assinatura } = await supabase
          .from('assinaturas')
          .select('usuario_id')
          .eq('mp_preapproval_id', preapprovalId)
          .single();

        if (assinatura?.usuario_id) {
          await supabase
            .from('usuarios')
            .update({ is_pro: true })
            .eq('id', assinatura.usuario_id);
        }
      }

      // Se cancelado, remove PRO
      if (status === 'cancelled') {
        const { data: assinatura } = await supabase
          .from('assinaturas')
          .select('usuario_id')
          .eq('mp_preapproval_id', preapprovalId)
          .single();

        if (assinatura?.usuario_id) {
          await supabase
            .from('usuarios')
            .update({ is_pro: false })
            .eq('id', assinatura.usuario_id);
        }
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
};
