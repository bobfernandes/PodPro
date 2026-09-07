// api/renovar-assinaturas.js — cron job mensal de renovação
// Roda diariamente, cobra quem vence em até 1 dia
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
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
      'X-Idempotency-Key': crypto.randomUUID(),
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
      .select('id, email, plano, plano_cancelado, mp_customer_id, mp_card_id, mp_card_method, plano_vencimento')
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

      // ── Cancelado: não cobra, só deixa o acesso expirar pro Ferreiro ──────
      if (user.plano_cancelado) {
        await supabase.from('usuarios')
          .update({ plano: 'ferreiro', plano_vencimento: null, plano_cancelado: false })
          .eq('id', user.id);
        console.log(`⏹️ Cancelado, não renovado: ${user.email} → rebaixado para ferreiro`);
        resultados.push({ email: user.email, status: 'cancelado_rebaixado' });
        continue;
      }

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

        console.log(`Payment raw ${user.id}:`, JSON.stringify(payment));

        // ── 2b. Erro de API do MP (não é uma decisão de pagamento) ───────
        // Não rebaixa o usuário por isso — é falha técnica, não recusa de cartão.
        // Fica pendente pra tentar de novo no próximo dia.
        if (!payment.id) {
          const motivo = payment.message || payment.error || (payment.cause && JSON.stringify(payment.cause)) || 'Erro desconhecido';
          console.error(`⚠️ Erro de API ao cobrar ${user.email} (usuário mantido): ${motivo}`);
          resultados.push({ email: user.email, status: 'erro_api', detalhe: motivo });
          continue;
        }

        // ── 3. Salva histórico ────────────────────────────────────────────
        const { error: insertErr } = await supabase.from('pagamentos').insert({
          usuario_id: user.id,
          plano: user.plano,
          mp_payment_id: String(payment.id),
          mp_status: payment.status,
          valor: planInfo.valor,
        });
        if (insertErr) console.error('Erro ao salvar em pagamentos:', insertErr.message);

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
          // Pagamento realmente recusado pelo banco/cartão — rebaixa para ferreiro
          await supabase.from('usuarios')
            .update({ plano: 'ferreiro', plano_vencimento: null })
            .eq('id', user.id);
          console.log(`❌ Recusado: ${user.email} → rebaixado para ferreiro (${payment.status_detail})`);
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
