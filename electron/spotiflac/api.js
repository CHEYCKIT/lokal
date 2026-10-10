const { service } = require('./packages')

async function dispatch(db, request = {}) {
  const packages = service(db), { action, key, id, url, values, input, token } = request
  switch (action) {
    case 'repositories': return packages.refreshDue()
    case 'catalogue': return packages.catalogue(id)
    case 'repository.add': return packages.addRepo(url)
    case 'repository.refresh': return packages.refreshRepo(id)
    case 'repository.remove': return packages.removeRepo(id)
    case 'package.install': return packages.install({ repositoryId: request.repositoryId, id })
    case 'package.upload': {
      if(typeof request.data!=='string'||request.data.length>44*1024*1024)throw new Error('Addon package exceeds 32 MB')
      return packages.install({buffer:Buffer.from(request.data,'base64')})
    }
    case 'package.action': return packages.invokeAction(key,id,input,token)
    case 'package.auth': return packages.authStatus(key)
    case 'package.verify': { const runtime=await packages.runtime(key);if(runtime.host.session)await runtime.host.session.bootstrap(runtime.host.signal);return packages.authStatus(key) }
    case 'package.openAuth': {
      if(process.versions.electron)return require('./authWindow').openAuthWindow(packages,key)
      return packages.authStatus(key)
    }
    case 'package.callback': return packages.authCallback(key,url)
    case 'package.logout': { const runtime=await packages.runtime(key);runtime.host.session?.clear();await runtime.host.authCall('clearAuth',[]);return {ok:true} }
    case 'package.home': return (await packages.runtime(key)).invoke('getHomeFeed')
    case 'package.browse': return (await packages.runtime(key)).invoke('getBrowseCategories')
    case 'package.playlist': return packages.album(key,id,true)
    case 'package.search': return packages.browse(key,request.query,request.filter)
    case 'package.settings': return packages.setSettings(key,values || {})
    case 'operation': return require('./media').operation(db,id,!!request.cancel)
    default: throw new Error('Unknown addon operation')
  }
}
module.exports = { dispatch }
