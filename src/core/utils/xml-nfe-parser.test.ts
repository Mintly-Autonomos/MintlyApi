import { describe, it, expect } from 'vitest';
import { parseNFeXml } from './xml-nfe-parser';
import * as fs from 'fs';
import * as path from 'path';

const mocksDir = path.resolve(__dirname, 'mocks');

function readMock(name: string): string {
  return fs.readFileSync(path.join(mocksDir, name), 'utf8');
}

describe('parseNFeXml', () => {
  it('NF-e Lucro Presumido (ICMS00)', () => {
    const xml = readMock('nfe-lucro-presumido.xml');
    const nota = parseNFeXml(xml);
    expect(nota.chaveAcesso).toHaveLength(44);
    expect(nota.modelo).toBe('55');
    expect(nota.emitente.cnpj).toBe('11111111111111');
    expect(nota.itens[0].vICMS).toBeCloseTo(36);
    expect(nota.itens[0].pICMS).toBeCloseTo(18);
    expect(nota.itens[0].vPIS).toBeCloseTo(3.30);
    expect(nota.totais.vNF).toBeCloseTo(200);
  });

  it('NF-e Simples Nacional (ICMSSN102)', () => {
    const xml = readMock('nfe-simples-nacional.xml');
    const nota = parseNFeXml(xml);
    expect(nota.itens[0].vICMS).toBe(0);
    expect(nota.itens[0].vBC).toBe(0);
    expect(nota.itens[0].vPIS).toBeCloseTo(0.66);
    expect(nota.itens[0].vCOFINS).toBeCloseTo(3.04);
  });

  it('NFC-e modelo 65', () => {
    const xml = readMock('nfce-venda.xml');
    const nota = parseNFeXml(xml);
    expect(nota.modelo).toBe('65');
    expect(nota.itens[0].vICMS).toBeCloseTo(2.16);
  });

  it('XML mal formado deve lançar erro', () => {
    const xml = '<nota><invalido></nota>';
    expect(() => parseNFeXml(xml)).toThrow(/inválido|invalido|não encontrado|not found/i);
  });
});
