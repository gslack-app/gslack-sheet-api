import { ApiServlet, ApiNotFoundHandler } from "./api";
import { ApiGatekeeper } from "./api-gatekeeper";
import { SpreadsheetAdapter } from "./spreadsheet-adapter";
import { ResourceHandler } from "./resource-handler";
import { Configuration, LogFilter, StackdriverLogger, CacheProvider } from "../core/common";
import { LogLevel, WebConfig, ICache } from "../core/interfaces";
import { HttpServletResponse, HttpServletContainer, HttpServletRequest } from "../core/servlet";
import { DependencyInjection } from "../core/vendors";
import { QueryAdapter } from "./query-adapter";
import { IDataAdapter } from "./interfaces";
import { Swagger } from "./swagger-v2";

let appName: string = PropertiesService.getScriptProperties().getProperty('app.name') || 'Sheet API';

export function doGet(request: any): any {
    let container = new HttpServletContainer();
    container.init(getConfig(), getDI());
    return container.doGet(request);
}

export function doPost(request: any): any {
    let container = new HttpServletContainer();
    container.init(getConfig(), getDI());
    return container.doPost(request);
}

export function onOpen(e: any): void {
    try {
        var spreadsheet = SpreadsheetApp.getActive();
        var menuItems = [
            { name: 'Authorize', functionName: 'authorizeScript' },
            { name: 'Initialize Settings', functionName: 'initSettings' },
            { name: 'Clear System Cache', functionName: 'clearSystemCache' },
            { name: 'Generate Swagger Document', functionName: 'generateSwaggerDoc' }
        ];
        spreadsheet.addMenu(appName, menuItems);
    }
    catch (err) {
        Browser.msgBox(err);
    }
}

export function initSettings(): void {
    try {
        let propSvc = PropertiesService.getScriptProperties();
        let settings: any = {
            'app.name': 'Sheet API',
            'app.title': 'Sheet REST API',
            'app.description': 'Auto-generated by  <a href="https://gslack.app">GSlack Sheet API Toolkit</a>',
            'app.version': '1.0.0',
            'app.logLevel': '1',
            'app.defaultRole': 'anonymous',
            'app.query.no_format': '1',
            'app.query.limit': '20',
            'app.contact.name': 'GSlack Team',
            'app.contact.url': 'https://gslack.app',
            'app.contact.email': 'info@gslack.app'
        };

        Object.keys(settings).forEach(prop => {
            let value = propSvc.getProperty(prop);
            if (!value)
                propSvc.setProperty(prop, settings[prop]);
        });
        Browser.msgBox(appName, 'Please configure the initialized settings', Browser.Buttons.OK);
    }
    catch (err) {
        Browser.msgBox(err);
    }
}

export function authorizeScript(): void {
    try {
        let authInfo = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
        let message = authInfo.getAuthorizationStatus() == ScriptApp.AuthorizationStatus.REQUIRED
            ? 'Authorization Failed'
            : 'Authorization Success';
        Browser.msgBox(appName, message, Browser.Buttons.OK);
    }
    catch (err) {
        Browser.msgBox(appName, err, Browser.Buttons.OK);
    }
}

export function clearSystemCache(): void {
    // Clear system cache
    let ss = SpreadsheetApp.getActiveSpreadsheet();
    let id = ss.getId();
    let di = getDI();
    let cacheSvc: ICache = di.get('ICache');
    let keys: string[] = ss.getSheets().map(sheet => `${id}.${sheet.getName()}`);
    cacheSvc.removeAll(keys);
    Browser.msgBox(appName, `The cache \\n${keys.join('\\n  ')}\\nare cleaned up`, Browser.Buttons.OK);
}

export function generateSwaggerDoc(): string {
    let di = getDI();
    let cacheSvc: IDataAdapter = di.get('IDataAdapter');
    cacheSvc.setCache(null);
    cacheSvc.init({ name: 'Schemas' });
    let schemas = cacheSvc.select();
    // Prepare Swagger information
    let svc = PropertiesService.getScriptProperties();
    let appName: string = svc.getProperty('app.name') || 'Sheet API';
    let title: string = svc.getProperty('app.title') || `${appName} REST API`;
    let description = svc.getProperty('app.description') || 'Auto-generated by  <a href="https://gslack.app">GSlack Sheet API Toolkit</a>'
    let version: string = svc.getProperty('app.version') || '1.0.0';
    let name: string = svc.getProperty('app.contact.name') || 'GSlack Team';
    let url: string = svc.getProperty('app.contact.url') || 'https://gslack.app';
    let email: string = svc.getProperty('app.contact.email') || 'info@gslack.app';
    let swagger = new Swagger();
    swagger.generate(schemas, {
        title: title,
        description: description,
        version: version,
        name: name,
        url: url,
        email: email
    });
    // Temporary: Output the result
    let json = swagger.getJSON();
    return json;
    // let ss = SpreadsheetApp.getActiveSpreadsheet();
    // ss.getActiveCell().setValue(json);
}

function getConfig(): WebConfig {
    let logLevel: any = PropertiesService.getScriptProperties().getProperty('app.logLevel') || LogLevel.INFO;
    let defaultRole: any = PropertiesService.getScriptProperties().getProperty('app.defaultRole');
    let noFormat: any = PropertiesService.getScriptProperties().getProperty('app.query.no_format');
    let limit: any = PropertiesService.getScriptProperties().getProperty('app.query.limit');

    return {
        name: appName,
        description: 'Sheet API',
        servlets: [
            {
                name: 'ApiServlet',
                param: {
                    schemas: 'Schemas',
                    noFormat: noFormat ? parseInt(noFormat) : 1,
                    limit: limit ? parseInt(limit) : 20
                }
            }
        ],
        routes: [
            {
                method: 'GET',
                handler: 'ApiServlet',
                patterns: [
                    /^\/api\/(?<resource>[^\s\/]{2,36})\/?(?<id>[^\s\/]{2,36})?(\/|$)/i
                ]
            },
            {
                method: 'POST',
                handler: 'ApiServlet',
                patterns: [
                    /^\/api\/(?<action>(create))\/(?<resource>[^\s\/]{2,36})(\/|$)/i,
                    /^\/api\/(?<action>(update|delete))\/(?<resource>[^\s\/]{2,36})\/?(?<id>[^\s\/]{2,36})?(\/|$)/i
                ]
            }
        ],
        context: {
            // Variables at servlet scope
        },
        filters: [
            {
                name: 'LogFilter',
                order: 0,
                param: { level: logLevel }
            },
            {
                name: 'ApiGatekeeper',
                order: 1,
                param: {
                    authentication: 'Authentication',
                    authorization: 'Authorization',
                    defaultRole: defaultRole
                }
            },
            {
                name: 'ResourceHandler',
                order: 2,
                param: {
                    resources: 'Resources'
                }
            }
        ]
    }
};

function getDI(): DependencyInjection {
    return new DependencyInjection([
        { name: 'ServletRequest', useClass: HttpServletRequest },
        { name: 'ServletResponse', useClass: HttpServletResponse },
        { name: 'NotFoundHandler', useClass: ApiNotFoundHandler },
        { name: 'IConfiguration', useClass: Configuration },
        { name: 'ILogger', useClass: StackdriverLogger, singleton: true },
        { name: 'ICache', useClass: CacheProvider, deps: ['ILogger'] },
        { name: 'IDataAdapter', useClass: SpreadsheetAdapter, deps: ['ICache'] },
        { name: 'IQueryAdapter', useClass: QueryAdapter, deps: ['ILogger'] },
        { name: 'LogFilter', useClass: LogFilter, deps: ['ILogger'] },
        { name: 'ApiServlet', useClass: ApiServlet, deps: ['ILogger', 'IQueryAdapter', 'IDataAdapter'] },
        { name: 'ApiGatekeeper', useClass: ApiGatekeeper, deps: ['ILogger', 'IDataAdapter'] },
        { name: 'ResourceHandler', useClass: ResourceHandler, deps: ['IDataAdapter'] }
    ]);
}