// 共享常量 - 所有规则模块共用

// 敏感变量名关键词
export const SENSITIVE_KEYWORDS = [
  'PASSWORD', 'PASSWD', 'SECRET', 'TOKEN', 'KEY', 'APIKEY', 'API_KEY',
  'CREDENTIAL', 'AUTH', 'PRIVATE', 'ACCESS_KEY', 'SECRET_KEY'
]

// 非敏感变量名白名单
export const NON_SENSITIVE_KEYWORDS = [
  'PORT', 'HOST', 'DEBUG', 'NODE_ENV', 'LOG_LEVEL', 'TIMEOUT', 'WORKERS', 'THREADS'
]

// 函数调用模式（需要排除）
export const FUNCTION_PATTERNS = [
  /^[a-zA-Z_]+\.[a-zA-Z_]+/,  // os.getenv, process.env
  /^[a-zA-Z_]+\(/,            // getenv(), GetEnv()
]

// 支持的数据库类型
export const DB_SCHEMES = [
  // 关系型数据库
  'postgres', 'postgresql', 'mysql', 'mariadb', 'sqlite', 'sqlite3',
  'mssql', 'sqlserver', 'oracle', 'oracledb', 'db2', 'ibmdb',
  'cockroachdb', 'crdb', 'citus',
  // NoSQL 数据库
  'mongodb', 'mongo', 'redis', 'rediss', 'memcached', 'memcache',
  'couchdb', 'couch', 'cassandra', 'scylla', 'dynamodb', 'dynamo',
  // 消息队列
  'amqp', 'amqps', 'rabbitmq', 'kafka', 'nats', 'natsws',
  'mosquitto', 'mqtt',
  // 其他
  'elasticsearch', 'elastic', 'influxdb', 'influx', 'timescaledb',
  'neo4j', 'arangodb', 'rethinkdb', 'etcd', 'zookeeper'
]
