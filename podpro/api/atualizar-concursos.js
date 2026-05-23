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

// Palavras-chave de educação para filtrar
const PALAVRAS_EDUCACAO = [
  'professor', 'professora', 'pedagogo', 'pedagoga', 'orientador',
  'coordenador', 'diretor de escola', 'supervisor de ensino',
  'docente', 'educação infantil', 'ensino fundamental', 'ensino médio',
  'magistério', 'licenciatura'
];

async function scrapeConCursosPorUF(uf) {
  // URL do PCI filtrada por UF na página de professores
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
  
  // O PCI usa estrutura de tabela/lista com padrão identificável
  // Cada concurso tem: órgão, UF, vagas, cargo, salário, data inscrição
  // Exemplo: "Prefeitura de Guarulhos · SP · 20 vagas até R$ 3.791,98 Professor de Educação Infantil Superior · 02/06/2026"
  
  // Regex para capturar blocos de concurso
  const blocoRegex = /([^·\n]+?)\s*·\s*(AC|AL|AM|AP|BA|CE|DF|ES|GO|MA|MG|MS|MT|PA|PB|PE|PI|PR|RJ|RN|RO|RR|RS|SC|SE|SP|TO)\s*·\s*([^·]+?vagas[^·]*?)\s*·\s*([^·\n]+?)\s*·\s*([\d\/]+(?:\s*a\s*[\d\/]+)?|Prorrogado[^·\n]*)/gi;

  let match;
  while ((match = blocoRegex.exec(html)) !== null) {
    const orgao = match[1].trim();
    const uf = match[2].trim();
    const vagasInfo = match[3].trim();
    const cargo = match[4].trim();
    const inscricao = match[5].trim();

    // Filtra pelo estado desejado
    if (uf !== ufFiltro.toUpperCase()) continue;

    // Verifica se é área de educação
    const cargoLower = cargo.toLowerCase();
    const eEducacao = PALAVRAS_EDUCACAO.some(p => cargoLower.includes(p));
    if (!eEducacao) continue;

    // Extrai vagas e salário
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
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET || 'podpro-cron-2026';

  if (authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Não autorizado' });
  }

  const resultados = [];
  const erros = [];

  console.log('Iniciando scraping do PCI Concursos para todos os estados...');

  for (const [uf, estado] of Object.entries(UF_ESTADOS)) {
    try {
      console.log(`Scraping ${uf} - ${estado}...`);
      const editais = await scrapeConCursosPorUF(uf);

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

      // Pequena pausa pra não sobrecarregar o servidor
      await new Promise(r => setTimeout(r, 500));

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
