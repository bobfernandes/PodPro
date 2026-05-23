const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const PALAVRAS_EDUCACAO = [
  'professor', 'professora', 'pedagogo', 'pedagoga', 'orientador',
  'coordenador', 'diretor de escola', 'supervisor de ensino',
  'docente', 'educação infantil', 'ensino fundamental', 'ensino médio',
  'magistério', 'licenciatura'
];

async function scrapeConCursosPorUF(uf) {
  const url = `https://www.pciconcursos.com.br/professores/`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9',
    }
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const html = await response.text();
  return parseEditais(html, uf);
}

function parseEditais(html, ufFiltro) {
  const editais = [];

  const blocoRegex = /([^·\n]+?)\s*·\s*(AC|AL|AM|AP|BA|CE|DF|ES|GO|MA|MG|MS|MT|PA|PB|PE|PI|PR|RJ|RN|RO|RR|RS|SC|SE|SP|TO)\s*·\s*([^·]+?vagas[^·]*?)\s*·\s*([^·\n]+?)\s*·\s*([\d\/]+(?:\s*a\s*[\d\/]+)?|Prorrogado[^·\n]*)/gi;

  let match;
  while ((match = blocoRegex.exec(html)) !== null) {
    const orgao = match[1].trim();
    const uf = match[2].trim();
    const vagasInfo = match[3].trim();
    const cargo = match[4].trim();
    const inscricao = match[5].trim();

    if (uf !== ufFiltro.toUpperCase()) continue;

    const cargoLower = cargo.toLowerCase();
    const eEducacao = PALAVRAS_EDUCACAO.some(p => cargoLower.includes(p));
    if (!eEducacao) continue;

    const vagasMatch = vagasInfo.match(/(\d+)\s*vagas?/i);
    const salarioMatch = vagasInfo.match(/R\$\s*([\d.,]+)/i);

    editais.push({
      cargo: cargo.replace(/\s+/g, ' ').trim(),
      cidade: orgao.replace(/\s+/g, ' ').trim(),
      banca: 'A confirmar',
      vagas: vagasMatch ? parseInt(vagasMatch[1]) : null,
      salario: salarioMatch ? `R$ ${salarioMatch[1]}` : 'A confirmar',
      inscricao: inscricao.trim(),
      status: 'Aberto',
      descricao: `Concurso público em ${uf} para ${cargo}`,
      link: `https://www.pciconcursos.com.br/concursos/${uf.toLowerCase()}/`
    });

    if (editais.length >= 10) break;
  }

  return editais;
}

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
      const editais = typeof cache.editais === 'string'
        ? JSON.parse(cache.editais)
        : cache.editais;
      return res.status(200).json({ ok: true, editais, fonte: 'cache', atualizado_em: cache.atualizado_em });
    }

    // Se não tem cache, faz scraping ao vivo
    console.log(`Scraping ao vivo para ${uf}...`);
    const editais = await scrapeConCursosPorUF(uf);

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
