const { StatusCodes } = require('http-status-codes');

const {
    db,
    USER_CALCULATIONS_TABLE,
    USERS_TABLE,
    selectUserCalculations,
    selectUserDataSources,
    selectUserCollections,
    selectFirstUser,
} = require('../../../services/db');

const { is_valid_uuid } = require('./_helpers');
const { getAndPrepareCalcResults, deleteAndClearCalculation } = require('../calculations/_helpers');

const { getAndPrepareDataSources } = require('../datasources/_helpers');
const { getAndPrepareCollections } = require('../collections/_helpers');

module.exports = { post };

let mapQueryFromDSforLimits = new Map(); // This is the hack TODO FIXME

/**
 * @api {post} /v0/webhooks/calc_update Update a status of a calculation
 * @apiName UpdateCalculation
 * @apiGroup Calculations
 * @apiPermission unprotected
 * @apiSuccess (202) reqId response sent to a separate server-side event stream.
 * @apiUse SSEStreamResponse
 */
async function post(req, res, next) {
    const { uuid, progress, result, error } = req.body;

    if (error) console.error(error); // TODO send errors in stream

    if (
        req.user &&
        req.session.passport.user &&
        req.user.id === req.session.passport.user &&
        req.query.limit
    ) {
        mapQueryFromDSforLimits.set(req.user.id, req.query);
        return next({ status: StatusCodes.ACCEPTED });
    }

    if (!uuid || !is_valid_uuid(uuid) || !progress) {
        return next({ status: StatusCodes.BAD_REQUEST });
    }

    res.status(StatusCodes.ACCEPTED).json({ reqId: req.id });

    const record = await db(USER_CALCULATIONS_TABLE).where({ uuid }).first('id', 'userId');
    const { userId, id } = record || {};

    if (!userId) {
        return next({
            status: StatusCodes.UNPROCESSABLE_ENTITY,
            error: 'Calculation is not available for provided UUID',
        });
    }

    const calculations = await selectUserCalculations({ id: userId });
    const output = await getAndPrepareCalcResults(userId, calculations, progress, result);

    if (output.error) {
        return next({ status: StatusCodes.UNPROCESSABLE_ENTITY, error: output.error });
    }

    const sseFilter = ({ session, user }) =>
        session?.passport?.user === userId || user?.id === userId;

    res.sse.send(sseFilter, { reqId: req.id, ...output }, 'calculations');

    if (output.data.some(({ progress }) => progress === 100)) {
        const user = await selectFirstUser({ [`${USERS_TABLE}.id`]: userId });
        const query = mapQueryFromDSforLimits.get(userId);

        const filters = await selectUserCollections(user);
        const preparedFilters = await getAndPrepareCollections(filters);

        res.sse.send(sseFilter, { reqId: req.id, ...preparedFilters }, 'filters');

        const datasources = await selectUserDataSources(user, query);
        const preparedDataSouces = await getAndPrepareDataSources(datasources);

        res.sse.send(sseFilter, { reqId: req.id, ...preparedDataSouces }, 'datasources');
    }

    if (progress === 100) setTimeout(async () => await deleteAndClearCalculation(userId, id), 3000);
}
