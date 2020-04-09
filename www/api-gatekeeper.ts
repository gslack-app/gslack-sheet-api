import { getStatusObject, doQuery } from "./api";
import { IDataAdapter, Identity, Rule, acl } from "./interfaces";
import { HttpFilter } from "../core/common";
import { ILogger, ServletRequest, ServletResponse, ICache, HttpStatusCode } from "../core/interfaces";

export class ApiGatekeeper extends HttpFilter {
    private logger: ILogger;
    private adapter: IDataAdapter;
    private cacheSvc: ICache;
    private identities: Identity[];
    private rules: Rule[];
    private aclSvc: acl.ACLService;

    constructor({ ICache, ILogger, IDataAdapter }: any) {
        super();
        this.cacheSvc = ICache;
        this.logger = ILogger;
        this.adapter = IDataAdapter;
    }

    init(param?: Record<string, any>): void {
        super.init(param);
        let { authentication, authorization } = this.param;
        this.adapter.init({ name: authentication });
        let identityCacheId = this.adapter.getSessionId();
        this.identities = this.cacheSvc.get(identityCacheId);
        if (!this.identities) {
            this.identities = this.adapter.select();
            this.cacheSvc.set(identityCacheId, this.identities)
        }

        this.adapter.init({ name: authorization });
        let ruleCacheId = this.adapter.getSessionId();
        this.rules = this.cacheSvc.get(ruleCacheId);
        if (!this.rules) {
            this.rules = this.adapter.select();
            this.cacheSvc.set(ruleCacheId, this.rules)
        }

        this.aclSvc = new acl.ACLService();
        // Get distinct roles
        let roles = Array.from(new Set(this.rules.map(r => r.role.trim().toLocaleLowerCase())));
        roles.forEach(r => this.aclSvc.createRole(r));
        this.rules.forEach(rule => this.aclSvc.createRule(
            rule.action.trim().toLocaleLowerCase(),
            rule.role.trim().toLocaleLowerCase())
        );
    }

    doFilter(req: ServletRequest, res: ServletResponse): void {
        let { token } = req.param;
        let identity = this.getIdenity(token);

        // Authentication check
        if (!identity) {
            this.logger.info(`Token ${token} is invalid`);
            res.json(getStatusObject(HttpStatusCode.UNAUTHORIZED)).end();
            return;
        }

        // Authorization check
        let apiRegex = /\/api\/v1\/(?<action>(create|update|delete))?\/?(?<resource>\w+)\/?(?<id>\d+)?\/?$/i;
        let authorized = apiRegex.test(req.url);
        if (authorized) {
            let { groups: { action, resource } } = apiRegex.exec(req.url);
            action = action || 'read';
            authorized = identity.roles.some(role => this.aclSvc.isAllowed(`${resource}.${action}`.toLocaleLowerCase(), role));
        }

        if (!authorized)
            res.json(getStatusObject(HttpStatusCode.FORBIDDEN)).end();
    }

    private getIdenity(token: string): Identity {
        if (token) {
            let rec = doQuery(`[*token=${token}]`, this.identities)[0];
            return {
                token: rec.token,
                roles: rec.roles.split(',').map(r => r.trim().toLocaleLowerCase())
            }
        }
        return null;
    }
}