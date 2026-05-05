import * as fs from 'fs';
import * as path from 'path';
import { parseNFeXml } from './xml-nfe-parser';

/**
 * Salva o XML da NF-e/NFC-e no diretório correto e retorna o caminho do arquivo salvo.
 * @param xml XML da nota fiscal (string)
 * @param restauranteId ID do restaurante
 * @returns Caminho absoluto do arquivo salvo
 */
export function saveNFeXml(xml: string, restauranteId: string): string {
  // Extrai chave de acesso e data de emissão para montar o nome/pasta
  const parsed = parseNFeXml(xml);
  const chaveAcesso = parsed.chaveAcesso || 'semchave';
  const data = parsed.dataEmissao ? new Date(parsed.dataEmissao) : new Date();
  const anoMes = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;
  const baseDir = path.resolve(__dirname, '../../../../data/raw/nfe', restauranteId, anoMes);
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  const timestamp = Date.now();
  const fileName = `${timestamp}-${chaveAcesso}.xml`;
  const filePath = path.join(baseDir, fileName);
  fs.writeFileSync(filePath, xml, 'utf8');
  return filePath;
}
