/**
 * dimona-product-catalog.js
 * ─────────────────────────────────────────────────────────────────────────────
 * FONTE DE VERDADE ÚNICA para todos os produtos Dimona no site.
 *
 * Como funciona:
 *  - O catálogo JSON (catalogo_dropsimples.json) é imutável e fornece os SKUs
 *    e preços reais. Quando você baixar uma versão nova, tudo atualiza sozinho.
 *  - Este arquivo define QUAIS produtos aparecem no site, COMO eles são
 *    apresentados (nome, flatlay, print areas) e filtra os estilos desejados.
 *  - Para adicionar/remover um produto: edite ONLY this file.
 *
 * Convenção de flatlays:
 *  - `{id}-front.png`  → frente    (ex: quality-tshirt-front.png)
 *  - `{id}-back.png`   → costas    (ex: quality-tshirt-back.png)
 *  - Flatlays ficam em: /images/flatlays/
 *
 * Print areas:
 *  - xCm / yCm      → posição do canto superior esquerdo da área de impressão
 *                      no flatlay, em centímetros
 *  - widthCm / heightCm → dimensões da área de impressão real (enviada à Dimona)
 *  - scale          → fator visual no canvas preview
 *
 * Para desativar um produto temporariamente: mude enabled: false
 * Para adicionar um novo produto: copie um bloco existente e ajuste os campos
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Mapa de cores: nome PT → hex ────────────────────────────────────────────
// Adicione aqui qualquer cor nova que aparecer no catálogo
const COLOR_HEX_MAP = {
  'Branco':           '#FFFFFF',
  'Preto':            '#1A1A1A',
  'Cinza Mescla':     '#9E9E9E',
  'Cinza Chumbo':     '#555555',
  'Cz Chumbo':        '#555555',
  'Azul Marinho':     '#1A237E',
  'Az Marinho':       '#1A237E',
  'Azul marinho':     '#1A237E',
  'Azul Royal':       '#1565C0',
  'Az Royal':         '#1565C0',
  'Azul Bebê':        '#90CAF9',
  'Azul Turquesa':    '#00BCD4',
  'Vermelho':         '#D32F2F',
  'Vinho':            '#880E4F',
  'Rosa Pink':        '#E91E63',
  'Rosa pink':        '#E91E63',
  'Rosa Bebê':        '#F8BBD9',
  'Amarelo Canário':  '#FFEE58',
  'Amarelo Ouro':     '#FFC107',
  'Laranja':          '#FF6D00',
  'Verde Bandeira':   '#1B5E20',
  'Verde Musgo':      '#558B2F',
  'Verde Limão':      '#CDDC39',
  'Roxo':             '#6A1B9A',
  'Marrom':           '#5D4037',
  'Cru':              '#F5F0E8',
  'Marfim':           '#FFFFF0',
  'Off White':        '#FAF9F6',
  'Marfim-Off white': '#FAF9F6',
};

// ─── Ordem de tamanhos para exibição ─────────────────────────────────────────
const SIZE_ORDER = [
  'PP', 'P', 'M', 'G', 'GG', 'XGG', 'G1', 'G2', 'G3', 'G4',
  'XS', 'S', 'L', 'XL', '2XL', '3XL',
  'Único', 'Unico',
  '310ml', '502ml',
  'A3', 'A2', 'A1', 'A0',
];

// ─── Definição dos produtos ───────────────────────────────────────────────────
//
// Campos obrigatórios:
//   id            – identificador único usado em flatlays e print areas
//   displayName   – nome exibido no site
//   catalogName   – deve bater com 'Nome do Produto' no JSON do catálogo
//   catalogStyle  – deve bater com 'Estilo' no JSON  (null = aceita todos os estilos)
//   sides         – ['front'] ou ['front','back']
//   enabled       – true/false
//
// Campos de print area (em cm):
//   printAreas.front / printAreas.back
//     xCm, yCm          → posição no flatlay
//     widthCm, heightCm → dimensões reais enviadas à Dimona
//     scale             → escala visual no canvas
//
// Campos opcionais:
//   fallbackPrice – preço fixo quando o catálogo não tiver preço preenchido (ex: Caneca Mágica)
//
const DIMONA_PRODUCTS = [

  // ── CAMISETAS ──────────────────────────────────────────────────────────────

  {
    id:           'quality-tshirt',
    displayName:  'Dimona Quality T-Shirt',
    catalogName:  'Dimona Quality',
    catalogStyle: 'T-Shirt',
    sides:        ['front', 'back'],
    enabled:      true,
    printAreas: {
      front: { xCm: 7.7,  yCm: 9.6,  widthCm: 29, heightCm: 42, scale: 0.195 },
      back:  { xCm: 8.5,  yCm: 8.7,  widthCm: 29, heightCm: 42, scale: 0.21  },
    },
  },

  {
    id:           'quality-regata',
    displayName:  'Dimona Quality Regata',
    catalogName:  'Dimona Quality',
    catalogStyle: 'Regata',
    sides:        ['front', 'back'],
    enabled:      true,
    printAreas: {
      front: { xCm: 8.7,  yCm: 10.6,  widthCm: 29, heightCm: 42, scale: 0.195 },
      back:  { xCm: 8.6,  yCm: 8.4,  widthCm: 28, heightCm: 42, scale: 0.24  },
    },
  },

  {
    id:           'classic-tshirt',
    displayName:  'Dimona Classic',
    catalogName:  'Dimona Classic',
    catalogStyle: 'T-Shirt',
    sides:        ['front', 'back'],
    enabled:      true,
    printAreas: {
      front: { xCm: 7.7,  yCm: 9.6,  widthCm: 29, heightCm: 42, scale: 0.195 },
      back:  { xCm: 8.5,  yCm: 8.7,  widthCm: 29, heightCm: 42, scale: 0.21  },
    },
  },

  {
    id:           'prime-tshirt',
    displayName:  'Dimona Prime',
    catalogName:  'Dimona Prime',
    catalogStyle: 'T-Shirt',
    sides:        ['front', 'back'],
    enabled:      true,
    printAreas: {
      front: { xCm: 5.5,  yCm: 8.0,  widthCm: 29, heightCm: 42, scale: 1.0 },
      back:  { xCm: 5.5,  yCm: 8.0,  widthCm: 29, heightCm: 42, scale: 1.0 },
    },
  },

  {
    id:           'oversized',
    displayName:  'Dimona Oversized',
    catalogName:  'Dimona Oversized',
    catalogStyle: 'Oversized',
    sides:        ['front', 'back'],
    enabled:      true,
    printAreas: {
      front: { xCm: 5.5,  yCm: 8.0,  widthCm: 29, heightCm: 42, scale: 1.0 },
      back:  { xCm: 5.5,  yCm: 8.0,  widthCm: 29, heightCm: 42, scale: 1.0 },
    },
  },

  {
    id:           'estonada-tshirt',
    displayName:  'Estonada',
    catalogName:  'Estonada',
    catalogStyle: 'T-Shirt',
    sides:        ['front', 'back'],
    enabled:      true,
    printAreas: {
      front: { xCm: 7.7,  yCm: 9.6,  widthCm: 29, heightCm: 42, scale: 0.195 },
      back:  { xCm: 8.5,  yCm: 8.7,  widthCm: 29, heightCm: 42, scale: 0.21  },
    },
  },

  {
    id:           'cropped',
    displayName:  'Cropped Quality',
    catalogName:  'Cropped Quality',
    catalogStyle: 'Cropped',
    sides:        ['front'],
    enabled:      true,
    printAreas: {
      front: { xCm: 8.5,  yCm: 11.2, widthCm: 26, heightCm: 18, scale: 0.24 },
    },
  },

  {
    id:           'manga-longa',
    displayName:  'Quality Manga Longa',
    catalogName:  'Quality Manga Longa',
    catalogStyle: 'Manga Longa',
    sides:        ['front', 'back'],
    enabled:      true,
    printAreas: {
      front: { xCm: 7.7,  yCm: 9.6,  widthCm: 29, heightCm: 42, scale: 0.195 },
      back:  { xCm: 8.5,  yCm: 8.7,  widthCm: 29, heightCm: 42, scale: 0.21  },
    },
  },

  // ── MOLETOM ────────────────────────────────────────────────────────────────

  {
    id:           'moletom-canguru',
    displayName:  'Casaco Moletom Canguru',
    catalogName:  'Casaco Moleton Prime Unissex Canguru',
    catalogStyle: 'Moleton',
    sides:        ['front', 'back'],
    enabled:      true,
    printAreas: {
      front: { xCm: 5.5,  yCm: 8.0,  widthCm: 27, heightCm: 26, scale: 1.0 },
      back:  { xCm: 5.5,  yCm: 8.0,  widthCm: 29, heightCm: 42, scale: 1.0 },
    },
  },

  // ── BONÉS ─────────────────────────────────────────────────────────────────

  {
    id:           'bone-confort',
    displayName:  'Boné Prime Confort',
    catalogName:  'Boné Prime Confort inteiro',
    catalogStyle: 'Boné',
    sides:        ['front'],
    enabled:      true,
    printAreas: {
      front: { xCm: 5.0,  yCm: 4.0,  widthCm: 12, heightCm: 8,  scale: 0.5 },
    },
  },

  {
    id:           'bone-americano',
    displayName:  'Boné Quality Americano',
    catalogName:  'Boné Quality Americano Inteiro',
    catalogStyle: 'Boné',
    sides:        ['front'],
    enabled:      true,
    printAreas: {
      front: { xCm: 5.0,  yCm: 4.0,  widthCm: 12, heightCm: 8,  scale: 0.5 },
    },
  },

  // ── ACESSÓRIOS ─────────────────────────────────────────────────────────────

  {
    id:           'caneca',
    displayName:  'Caneca 310ml',
    catalogName:  'Caneca',
    catalogStyle: 'Caneca',
    sides:        ['front'],
    enabled:      true,
    printAreas: {
      front: { xCm: 3.0,  yCm: 2.5,  widthCm: 20, heightCm: 10, scale: 0.5 },
    },
  },

  {
    id:           'caneca-magica',
    displayName:  'Caneca Mágica',
    catalogName:  'Caneca Mágica',
    catalogStyle: 'Caneca',
    sides:        ['front'],
    enabled:      true,
    fallbackPrice: 39.90,  // preço manual — catálogo não tem preço preenchido
    printAreas: {
      front: { xCm: 3.0,  yCm: 2.5,  widthCm: 20, heightCm: 10, scale: 0.5 },
    },
  },

  { 
    id:           'ecobag',
    displayName:  'Ecobag',
    catalogName:  'Ecobag',
    catalogStyle: 'Ecobag',
    sides:        ['front'],
    enabled:      true,
    printAreas: {
      front: { xCm: 7.3,  yCm: 10.8,  widthCm: 40, heightCm: 22, scale: 0.195 },
    },
  },

  {
    id:           'copo-termico',
    displayName:  'Garrafa Térmica 502ml',
    catalogName:  'Copo Térmico',
    catalogStyle: 'Copo',
    sides:        ['front'],
    enabled:      true,
    printAreas: {
      front: { xCm: 3.0,  yCm: 3.0,  widthCm: 18, heightCm: 12, scale: 0.5 },
    },
  },

  // ── POSTER ─────────────────────────────────────────────────────────────────

  {
    id:           'poster-a3-papel',
    displayName:  'Poster A3 Papel Fotográfico',
    catalogName:  'Postagem Poster Papel Fotográfico Branco A3',
    catalogStyle: 'Poster',
    sides:        ['front'],
    enabled:      true,
    printAreas: {
      front: { xCm: 0,    yCm: 0,    widthCm: 29.7, heightCm: 42, scale: 1.0 },
    },
  },

  // ── PRODUTOS FUTUROS (desativados) ─────────────────────────────────────────
  // Descomente e ajuste quando disponíveis

  // {
  //   id:           'polo',
  //   displayName:  'Polo',
  //   catalogName:  'Polo',          // confirmar nome exato quando entrar no catálogo
  //   catalogStyle: null,
  //   sides:        ['front'],
  //   enabled:      false,
  //   printAreas: {
  //     front: { xCm: 5.5, yCm: 8.0, widthCm: 25, heightCm: 35, scale: 1.0 },
  //   },
  // },

];

// ─────────────────────────────────────────────────────────────────────────────
// buildProductsFromCatalog
// ─────────────────────────────────────────────────────────────────────────────
// Recebe o array bruto do catalogo_dropsimples.json e retorna a lista de
// produtos prontos para o frontend, com SKUs reais, cores, tamanhos e preços.
//
// Cada produto retornado:
//   id, displayName, sides, printAreas  ← do DIMONA_PRODUCTS
//   variants[]  ← gerados a partir do catálogo JSON
//     sku, color, color_code, size, price, material, metodo
//
function buildProductsFromCatalog(rawCatalog) {
  const results = [];

  for (const productDef of DIMONA_PRODUCTS) {
    if (!productDef.enabled) continue;

    // Filtra linhas do catálogo que batem com este produto
    const rows = rawCatalog.filter(row => {
      if (row['Nome do Produto'] !== productDef.catalogName) return false;
      if (productDef.catalogStyle !== null && row['Estilo'] !== productDef.catalogStyle) return false;
      return true;
    });

    if (rows.length === 0) {
      console.warn(`[dimona-catalog] Nenhuma linha encontrada para: ${productDef.id} (${productDef.catalogName} / ${productDef.catalogStyle})`);
      continue;
    }

    // Monta variantes — deduplica por color+size
    const seen = new Set();
    const variants = [];

    for (const row of rows) {
      const sku = String(row['SKU'] || '').trim().replace(/\.0$/, '');
      const cor     = (row['Cor'] || '').trim();
      const tamanho = (row['Tamanho'] || '').trim();
      const precoRaw = row['Preço (R$)'];
      const preco   = precoRaw ? parseFloat(precoRaw) : (productDef.fallbackPrice || 0);

      if (!sku) continue;

      const key = `${cor}__${tamanho}`;
      if (seen.has(key)) continue;
      seen.add(key);

      variants.push({
        sku,
        color:      cor,
        color_code: COLOR_HEX_MAP[cor] || '#CCCCCC',
        size:       tamanho,
        price:      preco,
        material:   (row['Material / Composição'] || '').trim(),
        metodo:     (row['Método de Estampa'] || '').trim(),
      });
    }

    // Ordena: cor alfabética, depois tamanho por SIZE_ORDER
    variants.sort((a, b) => {
      if (a.color !== b.color) return a.color.localeCompare(b.color, 'pt');
      const ai = SIZE_ORDER.indexOf(a.size);
      const bi = SIZE_ORDER.indexOf(b.size);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    results.push({
      id:            productDef.id,
      title:         productDef.displayName,
      catalogName:   productDef.catalogName,
      catalogStyle:  productDef.catalogStyle,
      sides:         productDef.sides,
      printAreas:    productDef.printAreas,
      variants,
      variant_count: variants.length,
      // flatlay convention: /images/flatlays/{id}-front.png  /  {id}-back.png
      flatlay_base:  productDef.id,
    });
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// getPrintArea (helper para canvas — substitui dimona-print-areas.js)
// ─────────────────────────────────────────────────────────────────────────────
// Recebe o productId sintético (ex: 'quality-tshirt') e o side ('front'/'back')
// Retorna as coordenadas em pixels (300 DPI) prontas para o canvas.
//
function getPrintAreaPx(productId, side) {
  const DPI = 300;
  const cmToPx = cm => Math.round((cm / 2.54) * DPI);

  const def = DIMONA_PRODUCTS.find(p => p.id === productId);
  if (!def) return null;

  const area = def.printAreas?.[side];
  if (!area) return null;

  return {
    x:      cmToPx(area.xCm),
    y:      cmToPx(area.yCm),
    width:  cmToPx(area.widthCm),
    height: cmToPx(area.heightCm),
    scale:  area.scale || 1.0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  DIMONA_PRODUCTS,
  COLOR_HEX_MAP,
  SIZE_ORDER,
  buildProductsFromCatalog,
  getPrintAreaPx,
};
