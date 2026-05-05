import { Db, ObjectId } from 'mongodb';
import { NotaFiscalParsed } from '../../core/utils/nfe-types';
import { saveNFeXml } from '../../core/utils/save-nfe-xml';

/**
 * Importa uma NF-e/NFC-e já parseada para a collection purchases.
 * Cria supplier se não existir. Faz match parcial de ingredientes.
 * @param db Instância do MongoDB
 * @param nota Resultado de parseNFeXml
 * @param restauranteId Restaurante alvo
 * @param xml XML original da nota
 * @returns O _id do purchase criado
 */
export async function importNFeToPurchase(
  db: Db,
  nota: NotaFiscalParsed,
  restauranteId: string,
  xml: string
): Promise<ObjectId> {
  // 1. Buscar restaurante e validar CNPJ do destinatário
  const restaurants = db.collection('restaurants');
  const restaurante = await restaurants.findOne({ _id: new ObjectId(restauranteId) });
  if (!restaurante) {
    throw new Error('Restaurante não encontrado');
  }
  if (restaurante.cnpj !== nota.destinatario.cnpj) {
    throw new Error('CNPJ do destinatário não corresponde ao restaurante logado');
  }

  // 2. Verificar duplicidade de NF-e
  const purchases = db.collection('purchases');
  const existe = await purchases.findOne({
    chave_nfe: nota.chaveAcesso,
    restaurante_id: new ObjectId(restauranteId)
  });
  if (existe) {
    throw new Error('NF-e já importada anteriormente');
  }

  // 3. Salvar XML e obter caminho
  const xml_path = saveNFeXml(xml, restauranteId);

  // 4. Buscar ou criar supplier
  const suppliers = db.collection('suppliers');
  let supplier = await suppliers.findOne({ cnpj: nota.emitente.cnpj, restaurante_id: new ObjectId(restauranteId) });
  if (!supplier) {
    const supplierDoc = {
      nome: nota.emitente.razaoSocial,
      cnpj: nota.emitente.cnpj,
      contato: '',
      categorias: [],
      restaurante_id: new ObjectId(restauranteId)
    };
    const result = await suppliers.insertOne(supplierDoc);
    supplier = { ...supplierDoc, _id: result.insertedId };
  }

  // 5. Match de ingredientes com normalização
  const ingredients = db.collection('ingredients');
  const itens = await Promise.all(
    nota.itens.map(async (item) => {
      // Busca parcial: tenta xProd completo, depois primeiras 2 palavras
      let ingrediente = await ingredients.findOne({
        nome: { $regex: item.xProd, $options: 'i' },
        restaurante_id: new ObjectId(restauranteId)
      });
      if (!ingrediente) {
        const primeirasPalavras = item.xProd.split(' ').slice(0, 2).join(' ');
        ingrediente = await ingredients.findOne({
          nome: { $regex: primeirasPalavras, $options: 'i' },
          restaurante_id: new ObjectId(restauranteId)
        });
      }
      if (!ingrediente) {
        // eslint-disable-next-line no-console
        console.warn(`Ingrediente não encontrado para xProd='${item.xProd}'`);
      }
      return {
        ...(ingrediente ? { ingrediente_id: ingrediente._id } : {}),
        xProd: item.xProd, // rastreabilidade
        quantidade: item.qCom,
        valor: item.vProd,
        icms: item.vICMS,
        pis: item.vPIS,
        cofins: item.vCOFINS
      };
    })
  );

  // 6. Criar purchase
  const doc = {
    data: nota.dataEmissao ? new Date(nota.dataEmissao) : new Date(),
    fornecedor_id: supplier._id,
    itens,
    chave_nfe: nota.chaveAcesso,
    origem: 'upload',
    xml_path,
    restaurante_id: new ObjectId(restauranteId)
  };
  const result = await purchases.insertOne(doc);
  return result.insertedId;
}
