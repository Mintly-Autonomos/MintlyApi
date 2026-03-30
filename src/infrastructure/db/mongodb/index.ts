import MongoDBConnection from './mongodb-connection'

const mongoConnection = MongoDBConnection.getInstance()

export { mongoConnection }
export default MongoDBConnection
