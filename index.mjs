import { execSync } from 'child_process'
import { sql, createPool } from "slonik"

const DB_PORT = 6432

let containerId = ''
const timeoutError =  new Error(`Failed - connections were not released and got stuck in infinite queue`)

export const main = async () => {
  console.log(`Demo slonik issue where failed connections are not released`)

  console.log('start tmp db')
  containerId = execSync(`docker run --detach --env POSTGRES_USER=user --env POSTGRES_PASSWORD=password --env POSTGRES_DB=database -p ${DB_PORT}:5432 postgres`).toString().trim()
  console.log(`success - conatinerId=${containerId}`)

  console.log('wait for DB to be available')
  await new Promise(resolve => setTimeout(resolve, 3000))
  execSync(`docker exec ${containerId} pg_isready --timeout=60`, { stdio: 'inherit' })

  console.log('create a pool - 1 maximumPoolSize, 1 connectionRetryLimit')
  const pool = await createPool(`postgresql://user:password@127.0.0.1:${DB_PORT}/database`, {
    connectionRetryLimit: 1,
    maximumPoolSize: 1,
    connectionTimeout: 1000,
  });

  console.log('stop tmp db so future connections fail')
  execSync(`docker stop ${containerId}`)

  console.log('create a new connection to DB.  with one open slot, should fail immediately')
  await canConnectToDB(pool)

  console.log('create a new connection to DB.  With no open slots, should be queued forever')
  return Promise.race([
    new Promise((resolve, reject) => setTimeout(() => {
      reject(timeoutError)
    }, 5000)),
    canConnectToDB(pool)
  ])
}

export const canConnectToDB = async (/** @type {import('slonik').DatabasePool} */ pool) => {
  try {
    console.log('connecting to DB')
    await pool.connect(async (connection) => {
      console.log('connected to DB')
      return connection.oneFirst(sql.unsafe`SELECT NOW()`);
    })
    return true
  } catch (err) {
    console.log('failed to connect to DB')
  }
  return false
}

main()
  .then(() => {
    console.log("Success - failed connections released from pool as expected")
  })
  .catch((error) => {
    if (error === timeoutError) {
      console.log(error.message)
    } else {
      console.log("Failed - unknown error")
      console.error(error);
    }
  })
  .finally(() => {
    console.log('cleanup/exit')
    execSync(`docker rm -f ${containerId}`)
    process.exit()
  });
