(function(root){
  'use strict';
  async function uploadAndInsertHealthReport(options){
    const upload=options.upload, insert=options.insert, remove=options.remove;
    if(typeof upload!=='function'||typeof insert!=='function'||typeof remove!=='function') {
      throw new TypeError('upload, insert and remove functions are required');
    }
    const uploadResult=await upload();
    if(uploadResult&&uploadResult.error) throw uploadResult.error;
    try {
      return await insert();
    } catch(databaseError) {
      try {
        const removalResult=await remove();
        if(removalResult&&removalResult.error) {
          if(typeof options.onCleanupFailure==='function') options.onCleanupFailure({kind:'returned-error',error:removalResult.error});
        }
      } catch(cleanupError) {
        if(typeof options.onCleanupFailure==='function') options.onCleanupFailure({kind:'thrown-error',error:cleanupError});
      }
      throw databaseError;
    }
  }
  const api={uploadAndInsertHealthReport};
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  if(root) root.sehHealthUploadCleanup=api;
})(typeof window!=='undefined'?window:globalThis);
