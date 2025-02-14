const {
    COLLECTIONS_TYPES_TABLE,
    SHARED_COLLECTION_VISIBILITY,
    USER_SHARED_COLLECTIONS_TABLE,
    USER_COLLECTIONS_DATASOURCES_TABLE,
    db,
    selectUserCollections,
    upsertUserCollection,
    delsertSharedCollectionUsers,
    delsertCollectionDataSources,
} = require('../../../services/db');

module.exports = {
    getAndPrepareCollections,
    saveCollection,
};

async function getAndPrepareCollections(collections = { data: [], total: 0 }) {
    const collectionIds = collections.data.map(({ id }) => id);
    // const collectionTypeIds = collections.data.map(({ typeId }) => typeId);
    const sharedCollectionIds = collections.data.reduce((ids, { visibility, id }) => {
        if (visibility === SHARED_COLLECTION_VISIBILITY) ids.push(id);
        return ids;
    }, []);

    // collections.types = await db.select().from(COLLECTIONS_TYPES_TABLE).whereIn('id', collectionTypeIds);

    let dataSources = collectionIds.length
        ? await db(USER_COLLECTIONS_DATASOURCES_TABLE).whereIn('collectionId', collectionIds)
        : [];

    let users = sharedCollectionIds.length
        ? await db(USER_SHARED_COLLECTIONS_TABLE).whereIn('collectionId', sharedCollectionIds)
        : [];

    for (let collection of collections.data) {
        collection.dataSources = [];
        dataSources = dataSources.filter(({ dataSourceId, collectionId }) => {
            const related = collectionId === collection.id;
            related && collection.dataSources.push(dataSourceId);
            return !related;
        });

        collection.users = null;

        if (collection.visibility === SHARED_COLLECTION_VISIBILITY) {
            collection.users = [];
            users = users.filter(({ userId, collectionId }) => {
                const related = collectionId === collection.id;
                related && collection.users.push(userId);
                return !related;
            });
        }
    }

    return collections || [];
}

async function saveCollection(user, data) {
    const { dataSources = null, users = null, ...collectionData } = data;

    const upserted = await upsertUserCollection(user.id, collectionData);

    if (!upserted.id) {
        throw new Error('Collection is not saved.');
    }

    // const selected = await selectCollections({ id: upserted.id, userId });
    const selected = await selectUserCollections(user, { collectionIds: [upserted.id] });
    const collection = selected.data[0];

    if (!collection) {
        throw new Error('Collection is not retrieved.');
    }

    if (dataSources) {
        await delsertCollectionDataSources(collection.id, dataSources);
    }

    if (users && collection.visibility === SHARED_COLLECTION_VISIBILITY) {
        await delsertSharedCollectionUsers(collection.id, users);
    }

    collection.dataSources = dataSources;
    collection.users = users;

    return collection;
}
