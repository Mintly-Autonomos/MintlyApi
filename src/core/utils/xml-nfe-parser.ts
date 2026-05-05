import { XMLParser } from 'fast-xml-parser';
import { NotaFiscalParsed } from './nfe-types';

/**
 * Faz o parsing de um XML de NF-e/NFC-e e retorna os campos normalizados.
 * Ignora namespaces e nó Signature.
 * Campos ausentes retornam 0.
 */
export function parseNFeXml(xml: string | Buffer): NotaFiscalParsed {
  // 1. Converter Buffer para string se necessário
  const xmlStr = Buffer.isBuffer(xml) ? xml.toString('utf8') : xml;

  // 2. Remover apenas o nó Signature (assinatura digital)
  const xmlClean = xmlStr.replace(/<Signature[\s\S]*?<\/Signature>/g, '');

  // 3. Parsear XML com suporte a namespaces e array de det
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '_',
    removeNSPrefix: true,
    ignoreDeclaration: true,
    isArray: (name) => name === 'det',
    parseTagValue: false
  });
  const parsed = parser.parse(xmlClean);


  // 4. Encontrar o nó raiz correto (nfeProc, NFe, etc)
  const nfeProc = parsed.nfeProc || parsed['nfeProc'] || parsed.NFe || parsed['NFe'];
  const nfe = nfeProc?.NFe || nfeProc?.['NFe'] || nfeProc || parsed.NFe || parsed['NFe'];
  const infNFe = nfe?.infNFe || nfe?.['infNFe'] || nfe?.NFe?.infNFe || nfe?.NFe?.['infNFe'] || nfe;

  // Validação obrigatória
  if (!infNFe) {
    throw new Error('XML de NF-e inválido: nó infNFe não encontrado');
  }
  if (!infNFe.ide || !infNFe.emit) {
    throw new Error('XML de NF-e inválido: campos obrigatórios ausentes (ide, emit)');
  }

  // 5. Extrair campos principais
  const ide = infNFe?.ide || {};
  const emit = infNFe?.emit || {};
  const dest = infNFe?.dest || {};
  const total = infNFe?.total?.ICMSTot || {};
  const det = Array.isArray(infNFe?.det) ? infNFe.det : infNFe?.det ? [infNFe.det] : [];

  // 6. Montar objeto NotaFiscalParsed

  // Sempre usar _Id do infNFe para chave de acesso
  const chaveAcesso = String(infNFe?._Id ?? '')
    .replace(/^NFe/i, '')
    .replace(/[^0-9]/g, '')
    .slice(0, 44);

  const modelo = (Number(ide?.mod) === 65 ? '65' : '55') as '55' | '65';
  const dataEmissao = ide?.dhEmi || ide?.dEmi || '';
  const emitente = {
    cnpj: emit.CNPJ || '',
    razaoSocial: emit.xNome || '',
    uf: emit.UF || ''
  };
  const destinatario = {
    cnpj: dest.CNPJ || ''
  };

  // 7. Itens
  const itens = det.map((item: any) => {
    const prod = item.prod || {};
    // ICMS pode estar em item.imposto.ICMS.[ICMS00|ICMS10|...|ICMSSN900]
    const imposto = item.imposto || {};
    const icmsTag = imposto.ICMS ? Object.keys(imposto.ICMS)[0] : undefined;
    const icms = icmsTag ? imposto.ICMS[icmsTag] : {};
    const pisTag = imposto.PIS ? Object.keys(imposto.PIS)[0] : undefined;
    const pis = pisTag ? imposto.PIS[pisTag] : {};
    const cofinsTag = imposto.COFINS ? Object.keys(imposto.COFINS)[0] : undefined;
    const cofins = cofinsTag ? imposto.COFINS[cofinsTag] : {};
    const ipi = imposto.IPI || {};

    return {
      xProd: prod.xProd || '',
      qCom: Number(prod.qCom) || 0,
      vUnCom: Number(prod.vUnCom) || 0,
      vProd: Number(prod.vProd) || 0,
      uCom: prod.uCom || '',
      NCM: prod.NCM || '',
      vBC: Number(icms.vBC) || 0,
      vICMS: Number(icms.vICMS) || 0,
      pICMS: Number(icms.pICMS) || 0,
      vPIS: Number(pis.vPIS) || 0,
      pPIS: Number(pis.pPIS) || 0,
      vCOFINS: Number(cofins.vCOFINS) || 0,
      pCOFINS: Number(cofins.pCOFINS) || 0,
      vIPI: Number(ipi.vIPI) || 0
    };
  });

  // 8. Totais
  const totais = {
    vNF: Number(total.vNF) || 0,
    vICMS: Number(total.vICMS) || 0,
    vPIS: Number(total.vPIS) || 0,
    vCOFINS: Number(total.vCOFINS) || 0
  };

  return {
    chaveAcesso,
    modelo,
    dataEmissao,
    emitente,
    destinatario,
    itens,
    totais
  };
}