const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const CACHE_DIAS = 15; // dias antes de buscar novamente

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const { uf, estado } = req.body;
  if (!uf || !estado) return res.status(400).json({ error: 'UF e estado obrigatórios' });

  try {
    // Tenta buscar do cache
    const { data: cache } = await supabase
      .from('concursos_cache')
      .select('editais, atualizado_em')
      .eq('uf', uf)
      .single();

    // ✅ Verifica se o cache existe E ainda está dentro do prazo
    if (cache && cache.editais && cache.atualizado_em) {
      const idadeMs = Date.now() - new Date(cache.atualizado_em).getTime();
      const idadeDias = idadeMs / (1000 * 60 * 60 * 24);

      if (idadeDias < CACHE_DIAS) {
        // Cache válido — retorna sem buscar na API
        console.log(`Cache válido para ${uf}: ${Math.floor(idadeDias)} dias`);
        const editais = JSON.parse(cache.editais);
        return res.status(200).json({
          ok: true,
          editais,
          fonte: 'cache',
          atualizado_em: cache.atualizado_em
        });
      }
      console.log(`Cache expirado para ${uf}: ${Math.floor(idadeDias)} dias — buscando novo`);
    }

    // Cache não existe ou expirou — busca ao vivo
    const apiKey = process.env.ANTHROPIC_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Chave não configurada' });

    const prompt = `Pesquise concursos publicos abertos ou com inscricoes previstas a partir de 2026 na area de EDUCACAO (professor, pedagogo, orientador, coordenador, diretor) em ${estado}. Responda SOMENTE com JSON valido sem markdown: {"editais":[{"cargo":"string","cidade":"string","banca":"string","vagas":null,"salario":"string","inscricao":"string","status":"Aberto","descricao":"string","link":"string"}]}.`;

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
    if (!m) throw new Error('sem JSON na resposta');

    const editais = JSON.parse(m[0]).editais || [];
    const agora = new Date().toISOString();

    // Salva cache com data atual
    await supabase.from('concursos_cache').upsert({
      uf,
      estado,
      editais: JSON.stringify(editais),
      atualizado_em: agora
    }, { onConflict: 'uf' });

    console.log(`✅ Cache atualizado para ${uf}: ${editais.length} editais`);

    return res.status(200).json({
      ok: true,
      editais,
      fonte: 'live',
      atualizado_em: agora
    });

  } catch (err) {
    console.error('buscar-concursos error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
