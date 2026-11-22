'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {uploadAndInsertHealthReport}=require('../health-upload-cleanup.js');

test('successful upload and insert do not attempt cleanup',async()=>{
 let removed=0;
 const result=await uploadAndInsertHealthReport({upload:async()=>({data:{path:'x'}}),insert:async()=>({ok:true}),remove:async()=>{removed++;},});
 assert.deepEqual(result,{ok:true}); assert.equal(removed,0);
});
test('upload failure prevents insert and cleanup',async()=>{
 let inserted=0,removed=0; const uploadError=new Error('upload failed');
 await assert.rejects(uploadAndInsertHealthReport({upload:async()=>({error:uploadError}),insert:async()=>{inserted++;},remove:async()=>{removed++;}}),e=>e===uploadError);
 assert.equal(inserted,0); assert.equal(removed,0);
});
test('insert failure removes uploaded file and preserves database error',async()=>{
 let removed=0; const dbError=new Error('insert failed');
 await assert.rejects(uploadAndInsertHealthReport({upload:async()=>({data:{}}),insert:async()=>{throw dbError;},remove:async()=>{removed++;return {data:[]};}}),e=>e===dbError);
 assert.equal(removed,1);
});
test('resolved remove result containing error is observable and database error remains primary',async()=>{
 const dbError=new Error('insert failed'),cleanupError={statusCode:'500',message:'storage removal failed'};
 const events=[];
 await assert.rejects(uploadAndInsertHealthReport({upload:async()=>({}),insert:async()=>{throw dbError;},remove:async()=>({error:cleanupError}),onCleanupFailure:e=>events.push(e)}),e=>e===dbError);
 assert.equal(events.length,1); assert.equal(events[0].kind,'returned-error'); assert.equal(events[0].error,cleanupError);
});
test('thrown remove error is observable and database error remains primary',async()=>{
 const dbError=new Error('insert failed'),cleanupError=new Error('network down');
 const events=[];
 await assert.rejects(uploadAndInsertHealthReport({upload:async()=>({}),insert:async()=>{throw dbError;},remove:async()=>{throw cleanupError;},onCleanupFailure:e=>events.push(e)}),e=>e===dbError);
 assert.equal(events.length,1); assert.equal(events[0].kind,'thrown-error'); assert.equal(events[0].error,cleanupError);
});
