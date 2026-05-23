const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const UF_ESTADOS = {
  AC:"Acre",AL:"Alagoas",AM:"Amazonas",AP:"Amapá",BA:"Bahia",
  CE:"Ceará",DF:"Distrito Federal",ES:"Espírito Santo",GO:"Goiás",
  MA:"Maranhão",MG:"Minas Gerais",MS:"Mato Grosso do Sul",MT:"Mato Grosso",
  PA:"Pará",PB:"Paraíba",PE:"Pernambuco",PI:"Piauí",PR:"Paraná",
  RJ:"Rio de Janeiro",RN:"Rio Grande do Norte",RO:"Rondônia",RR:"Roraima",
  RS:"Rio Grande do Sul",SC:"Santa Catarina",SE:"Sergipe",SP:"São Paulo",
  TO:"Tocantins"
};

async function buscarEditaisPorEstado(uf, estado, apiKey) {
  const prompt = `Pesquise concursos publicos abertos ou previstos para 2025 e 2026 na area de EDUCACAO (professor, pedagogo, orientador, coordenador, diretor) em ${estado}. Responda SOMENTE com JSON valido sem markdown: {"editais":[{"cargo":"string","cidade":"string","banca":"string","vagas":null,"salario":"string","inscricao":"string","status":"Aberto","descricao":"string","link":"string"}]} Maximo 5 editais reais.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) throw new Error(`Anthropic error: ${response.status}`);

  const data = await response.json();
  const txt = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const m = txt.match(/\{[\s\S]*"editais"[\s\S]*\}/);
  if (!m) throw new Error('sem JSON');

  return JSON.parse(m[0]).editais || [];
}

module.exports = async (req, res) => {
  // Verifica se é chamada do cron do Vercel ou manual com senha
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET || 'podpro-cron-2026';
  
  if (authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Não autorizado' });
  }

  const apiKey = process.env.ANTHROPIC_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_KEY não configurada' });

  const resultados = [];
  const erros = [];

  console.log('Iniciando atualização de concursos para todos os estados...');

  for (const [uf, estado] of Object.entries(UF_ESTADOS)) {
    try {
      console.log(`Buscando ${uf} - ${estado}...`);
      const editais = await buscarEditaisPorEstado(uf, estado, apiKey);

      // Salva/atualiza no Supabase
      const { error } = await supabase
        .from('concursos_cache')
        .upsert({
          uf,
          estado,
          editais: JSON.stringify(editais),
          atualizado_em: new Date().toISOString()
        }, { onConflict: 'uf' });

      if (error) throw error;

      resultados.push({ uf, total: editais.length });
      console.log(`✓ ${uf}: ${editais.length} editais`);

      // Aguarda 2s entre chamadas pra não sobrecarregar a API
      await new Promise(r => setTimeout(r, 2000));

    } catch (err) {
      console.error(`✗ ${uf}: ${err.message}`);
      erros.push({ uf, erro: err.message });
    }
  }

  return res.status(200).json({
    ok: true,
    atualizados: resultados.length,
    erros: erros.length,
    detalhes: resultados,
    falhas: erros
  });
};
