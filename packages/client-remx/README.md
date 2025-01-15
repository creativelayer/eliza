
Moment Memory:
 id: moment.id + agentId
 userId: moment.accountId
 agentId: agentId
 roomId: specific to the author of the moment, i.e. moment.accountId
 content: {
    text: moment.title + '\n' +moment.description
    action: ?
    source: 'remx'
    url: share url for the moment
    attachments: [moment.image ]
 }
 createdAt: moment.createdAt
 embedding: getEmbeddingZeroVector(),


initialize the last seen moment from cache

every X minutes, load the latest moments from remx up to the last seen moment or everything on sale now?
- check if the moment is in the agent memory and add it if not
- cache last seen moment id
-