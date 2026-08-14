const fs = require('fs');
const path = require('path');

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (inQuotes) {
      if (character === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += character;
      }
    } else if (character === '"') {
      inQuotes = true;
    } else if (character === ',') {
      values.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }

  values.push(current.trim());
  return values;
}

function parseCsvFile(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim());
  const headers = parseCsvLine(lines[0] || '');

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return headers.reduce((row, header, index) => {
      row[header] = values[index] || '';
      return row;
    }, {});
  });
}

let areasData = [];
let cursosData = [];

try {
  areasData = parseCsvFile(path.join(__dirname, '..', 'assets', 'tabela_area.csv'));
  cursosData = parseCsvFile(path.join(__dirname, '..', 'assets', 'tabela_curso_graduacao.csv'));
} catch (error) {
  console.warn('Erro ao carregar tabelas de formação:', error.message);
}

const NO_DEGREE_COURSE = 'Não possui curso de graduação';

function getAreas() {
  return areasData.map((area) => ({ codigo: area.Codigo, area: area.Area }));
}

function getCursosByArea(codigoArea) {
  const cursos = cursosData
    .filter((curso) => curso.CodigoArea === codigoArea)
    .map((curso) => curso.NomeCurso);

  if (!cursos.includes(NO_DEGREE_COURSE)) {
    return [NO_DEGREE_COURSE, ...cursos];
  }
  return cursos;
}

function getCursosMap() {
  return getAreas().reduce((map, area) => {
    map[area.codigo] = getCursosByArea(area.codigo);
    return map;
  }, {});
}

module.exports = { getAreas, getCursosByArea, getCursosMap, NO_DEGREE_COURSE };
