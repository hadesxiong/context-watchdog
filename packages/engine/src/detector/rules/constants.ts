// 共享常量：敏感/非敏感变量名关键词、函数调用模式、数据库连接串 scheme。

export const SENSITIVE_KEYWORDS = [
  'PASSWORD', 'PASSWD', 'SECRET', 'TOKEN', 'KEY', 'APIKEY', 'API_KEY',
  'CREDENTIAL', 'AUTH', 'PRIVATE', 'ACCESS_KEY', 'SECRET_KEY'
]

export const NON_SENSITIVE_KEYWORDS = [
  'PORT', 'HOST', 'DEBUG', 'NODE_ENV', 'LOG_LEVEL', 'TIMEOUT', 'WORKERS', 'THREADS'
]

export const FUNCTION_PATTERNS = [
  /^[a-zA-Z_]+\.[a-zA-Z_]+/,  // os.getenv, process.env
  /^[a-zA-Z_]+\(/,            // getenv(), GetEnv()
]

export const DB_SCHEMES = [
  // 关系型数据库
  'postgres', 'postgresql', 'mysql', 'mariadb', 'sqlite', 'sqlite3',
  'mssql', 'sqlserver', 'oracle', 'oracledb', 'db2', 'ibmdb',
  'cockroachdb', 'crdb', 'citus',
  // NoSQL
  'mongodb', 'mongo', 'redis', 'rediss', 'memcached', 'memcache',
  'couchdb', 'couch', 'cassandra', 'scylla', 'dynamodb', 'dynamo',
  // 消息队列
  'amqp', 'amqps', 'rabbitmq', 'kafka', 'nats', 'natsws',
  'mosquitto', 'mqtt',
  // 其他
  'elasticsearch', 'elastic', 'influxdb', 'influx', 'timescaledb',
  'neo4j', 'arangodb', 'rethinkdb', 'etcd', 'zookeeper'
]
