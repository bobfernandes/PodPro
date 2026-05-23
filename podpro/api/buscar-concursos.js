const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const { uf, estado } = req.body;
  if (!uf || !estado) return res.status(400).json({ error: 'UF e estado obrigatórios' });

  try {
    // Tenta buscar do cache primeiro
    const { data: cache } = await supabase
      .from('concursos_cache')
      .select('editais, atualizado_em')
      .eq('uf', uf)
      .single();

    if (cache && cache.editais) {
      const editais = JSON.parse(cache.editais);
      return res.status(200).json({ ok: true, editais, fonte: 'cache', atualizado_em: cache.atualizado_em });
    }

    // Se não tem cache, busca ao vivo
    const apiKey = process.env.ANTHROPIC_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Chave não configurada' });

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

    const editais = JSON.parse(m[0]).editais || [];

    // Salva no cache
    await supabase.from('concursos_cache').upsert({
      uf, estado,
      editais: JSON.stringify(editais),
      atualizado_em: new Date().toISOString()
    }, { onConflict: 'uf' });

    return res.status(200).json({ ok: true, editais, fonte: 'live' });

  } catch (err) {
    console.error('buscar-concursos error:', err);
    return res.status(500).json({ error: err.message });
  }
};
