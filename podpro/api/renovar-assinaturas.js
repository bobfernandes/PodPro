// api/renovar-assinaturas.js — cron job mensal de renovação
// Roda diariamente, cobra quem vence em até 1 dia
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const PLANOS = {
  libaneo:  { nome: 'Plano Libâneo – PodPrô',  valor: 7.97  },
  vygotsky: { nome: 'Plano Vygotsky – PodPrô', valor: 17.97 },
  piaget:   { nome: 'Plano Piaget – PodPrô',   valor: 27.97 },
};

async function mpPost(path, body) {
  const r = await fetch(`https://api.mercadopago.com${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  return r.json();
}

module.exports = async (req, res) => {
  // Segurança: só aceita chamada do Vercel Cron ou com secret
  const secret = req.headers['x-cron-secret'];
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Não autorizado' });
  }

  console.log('🔄 Iniciando renovação de assinaturas:', new Date().toISOString());

  try {
    // Busca usuários com plano pago, cartão salvo e vencimento em até 1 dia
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);

    const { data: usuarios, error } = await supabase
      .from('usuarios')
      .select('id, email, plano, mp_customer_id, mp_card_id, mp_card_method, plano_vencimento')
      .not('plano', 'eq', 'ferreiro')
      .not('mp_card_id', 'is', null)
      .lte('plano_vencimento', amanha.toISOString());

    if (error) throw new Error('Supabase error: ' + error.message);
    if (!usuarios?.length) {
      console.log('Nenhuma assinatura para renovar hoje.');
      return res.status(200).json({ ok: true, renovadas: 0 });
    }

    console.log(`Renovando ${usuarios.length} assinaturas...`);
    const resultados = [];

    for (const user of usuarios) {
      const planInfo = PLANOS[user.plano];
      if (!planInfo) continue;

      try {
        // ── 1. Gera token do cartão salvo ────────────────────────────────
        const cardToken = await mpPost(
          `/v1/customers/${user.mp_customer_id}/cards/${user.mp_card_id}/tokens`, {}
        );

        if (!cardToken.id) {
          throw new Error('Token inválido: ' + JSON.stringify(cardToken));
        }

        // ── 2. Cria cobrança ──────────────────────────────────────────────
        const payment = await mpPost('/v1/payments', {
          transaction_amount: planInfo.valor,
          token: cardToken.id,
          installments: 1,
          payment_method_id: user.mp_card_method,
          payer: {
            type: 'customer',
            id: user.mp_customer_id,
          },
          external_reference: JSON.stringify({ usuario_id: user.id, plano: user.plano }),
          description: planInfo.nome + ' – Renovação',
          statement_descriptor: 'PODPRO',
        });

        console.log(`Payment ${user.id}: ${payment.status}`);

        // ── 3. Salva histórico ────────────────────────────────────────────
        await supabase.from('pagamentos').insert({
          usuario_id: user.id,
          plano: user.plano,
          mp_payment_id: String(payment.id),
          mp_status: payment.status,
          valor: planInfo.valor,
        });

        if (payment.status === 'approved') {
          // Renova por mais 30 dias
          const novoVencimento = new Date();
          novoVencimento.setDate(novoVencimento.getDate() + 30);
          await supabase.from('usuarios')
            .update({ plano_vencimento: novoVencimento.toISOString() })
            .eq('id', user.id);
          console.log(`✅ Renovado: ${user.email} → ${novoVencimento.toDateString()}`);
          resultados.push({ email: user.email, status: 'renovado' });
        } else {
          // Pagamento falhou — rebaixa para ferreiro
          await supabase.from('usuarios')
            .update({ plano: 'ferreiro', plano_vencimento: null })
            .eq('id', user.id);
          console.log(`❌ Falhou: ${user.email} → rebaixado para ferreiro`);
          resultados.push({ email: user.email, status: 'rebaixado', detalhe: payment.status_detail });
        }

      } catch (err) {
        console.error(`Erro ao renovar ${user.email}:`, err.message);
        resultados.push({ email: user.email, status: 'erro', detalhe: err.message });
      }
    }

    return res.status(200).json({ ok: true, renovadas: resultados.length, resultados });

  } catch (err) {
    console.error('renovar-assinaturas error:', err);
    return res.status(500).json({ error: err.message });
  }
};
