module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const { uf, estado } = req.body;
  if (!uf || !estado) return res.status(400).json({ error: 'UF e estado obrigatórios' });

  const apiKey = process.env.ANTHROPIC_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Chave não configurada' });

  try {
    const prompt = `Pesquise concursos publicos abertos ou previstos para 2025 e 2026 na area de EDUCACAO (professor, pedagogo, orientador, coordenador, diretor) em ${estado}. Responda SOMENTE com JSON valido sem markdown: {"editais":[{"cargo":"string","cidade":"string","banca":"string","vagas":null,"salario":"string","inscricao":"string","status":"Aberto","descricao":"string","link":"string"}]} Maximo 5 editais reais.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
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
    return res.status(200).json({ ok: true, editais });
  } catch (err) {
    console.error('buscar-concursos error:', err);
    return res.status(500).json({ error: err.message });
  }
};
