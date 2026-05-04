"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = require("node:fs/promises");
const swagger_parser_1 = __importDefault(require("@apidevtools/swagger-parser"));
const build_server_1 = require("../src/infrastructure/server/build-server");
async function main() {
    const server = await (0, build_server_1.buildServer)();
    try {
        await server.ready();
        const swaggerDocument = server.swagger();
        await swagger_parser_1.default.validate(swaggerDocument);
        if (swaggerDocument.openapi == null) {
            throw new Error('Swagger validation failed: OpenAPI version is missing');
        }
        if (swaggerDocument.paths?.['/health'] == null) {
            throw new Error('Swagger validation failed: /health route is missing from the spec');
        }
        if (swaggerDocument.paths?.['/people'] == null) {
            throw new Error('Swagger validation failed: /people route is missing from the spec');
        }
        await (0, promises_1.mkdir)('artifacts', { recursive: true });
        await (0, promises_1.writeFile)('artifacts/swagger.json', JSON.stringify(swaggerDocument, null, 2));
        console.log('Swagger document validated and exported to artifacts/swagger.json');
    }
    finally {
        await server.close();
    }
}
void main();
