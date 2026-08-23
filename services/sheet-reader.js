const fs = require('fs');
const Excel = require('exceljs');

// Lê a primeira planilha de um arquivo XLSX e devolve um array de objetos
// cujas chaves são os títulos da primeira linha. Celas vazias viram string
// vazia e linhas totalmente vazias são puladas — comportamento equivalente
// ao XLSX.utils.sheet_to_json usado anteriormente (o .xls legado não é
// suportado por este leitor).
async function readFirstSheetRows(file) {
  const buffer = typeof file === 'string'
    ? await fs.promises.readFile(file)
    : Buffer.from(file || []);

  const workbook = new Excel.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) return [];

  const headers = (sheet.getRow(1).values || []).slice(1).map((value) => (value == null ? '' : String(value)));
  if (!headers.some((header) => header !== '')) return [];

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = row.values;
    const record = {};
    for (let i = 1; i <= headers.length; i++) {
      const cell = values[i];
      record[headers[i - 1]] = (cell == null || cell === undefined) ? '' : cell;
    }
    if (!Object.values(record).some((value) => value !== '' && value != null)) return;
    rows.push(record);
  });

  return rows;
}

module.exports = { readFirstSheetRows };
