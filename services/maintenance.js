const { stopEmailWorkers, startEmailWorkers } = require('./email');

let maintenanceActive = false;
let activeRequests = 0;

function maintenanceGuard(req, res, next) {
  const maintenanceRequest = req.path === '/admin/db/reset'
    || req.path === '/admin/backup/restore'
    || req.path === '/admin/backup/download';
  if (maintenanceRequest && !maintenanceActive) return next();
  if (maintenanceActive) {
    return res.status(503).set('Retry-After', '5').send('Sistema temporariamente indisponível para manutenção.');
  }
  activeRequests += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeRequests -= 1;
  };
  res.once('finish', release);
  res.once('close', release);
  return next();
}

async function waitForRequests() {
  while (activeRequests > 0) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function runMaintenance(operation) {
  if (maintenanceActive) throw new Error('Já existe uma operação de manutenção em andamento.');
  maintenanceActive = true;
  let result;
  let operationError = null;
  try {
    await waitForRequests();
    await stopEmailWorkers();
    result = await operation();
  } catch (error) {
    operationError = error;
  }
  let restartError = null;
  try { startEmailWorkers(); } catch (error) { restartError = error; }
  maintenanceActive = false;
  if (operationError && restartError) throw new AggregateError([operationError, restartError], 'A manutenção e o reinício dos workers falharam.');
  if (operationError) throw operationError;
  if (restartError) throw new Error(`A manutenção terminou, mas os workers não reiniciaram: ${restartError.message}`);
  return result;
}

module.exports = { maintenanceGuard, runMaintenance };
