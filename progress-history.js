const PROGRESS_HISTORY_PAGE_SIZE=500;
const progressHistoryReadCache=new Map();
const progressHistoryReadInFlight=new Map();
async function sbGetAllPages(path,pageSize=PROGRESS_HISTORY_PAGE_SIZE){
 if(!Number.isInteger(pageSize)||pageSize<1||pageSize>1000)throw new Error("Invalid progress-history page size.");
 const all=[],seenIds=new Set();
 let offset=0,pages=0;
 while(true){
  if(++pages>10000)throw new Error("Progress history exceeded the safe pagination limit.");
  const separator=path.includes("?")?"&":"?";
  const page=await sbGet(path+separator+"limit="+pageSize+"&offset="+offset);
  if(!Array.isArray(page))throw new Error("Progress-history response was not an array.");
  if(!page.length)break;
  for(const row of page){
   const id=row&&row.id!=null?String(row.id):null;
   if(id!==null&&seenIds.has(id))continue;
   if(id!==null)seenIds.add(id);
   all.push(row);
  }
  if(page.length<pageSize)break;
  offset+=page.length;
 }
 return all;
}
function isProgressManualRecord(row){
 const notes=String(row&&row.notes||"");
 return notes.includes("MANUAL_PROGRESS_ENTRY")||notes.includes("ثبت پیشرفت دوره‌ای");
}
function progressWeightKey(date,weight){
 if(date==null||date===""||weight==null||weight==="")return null;
 const numeric=Number(weight);
 if(!Number.isFinite(numeric))return null;
 return String(date).slice(0,10)+"|"+String(numeric);
}
function progressSourceLabel(row){
 if(row&&row._weightOnly===true)return "فقط ثبت وزن";
 const notes=String(row&&row.notes||"");
 if(notes.includes("MANUAL_PROGRESS_ENTRY"))return "ثبت شاگرد";
 if(notes.includes("ثبت پیشرفت دوره‌ای"))return "ثبت قدیمی · منبع نامشخص";
 if(notes.includes("COACH_PROGRESS_ENTRY"))return "ثبت مربی";
 return "آنالیز مربی";
}
function buildProgressHistoryRows(analysisRows,weightRows){
 const allAnalysisRows=Array.isArray(analysisRows)?analysisRows:[];
 const allManualRows=allAnalysisRows.filter(isProgressManualRecord);
 const explicitMarkerKeys=new Set(allManualRows
  .filter(row=>String(row&&row.notes||"").includes("MANUAL_PROGRESS_ENTRY"))
  .map(row=>progressWeightKey(row.analysis_date,row.weight)).filter(Boolean));
 // When a new idempotent marker row matches a legacy row exactly, show the
 // explicit source row once. Keep all other same-day entries: equal values
 // alone are not enough evidence to discard distinct historical records.
 const manualRows=allManualRows
  .filter(row=>String(row&&row.notes||"").includes("MANUAL_PROGRESS_ENTRY")||
    !explicitMarkerKeys.has(progressWeightKey(row.analysis_date,row.weight)))
  .map(row=>Object.assign({},row,{_weightOnly:false}));
 const coachRows=allAnalysisRows
  .filter(row=>!isProgressManualRecord(row))
  .map(row=>Object.assign({},row,{_weightOnly:false,_coachAnalysis:true}));
 const matchedManualWeights=new Set(manualRows.map(row=>progressWeightKey(row.analysis_date,row.weight)).filter(Boolean));
 const weightOnly=(Array.isArray(weightRows)?weightRows:[])
  .filter(row=>!matchedManualWeights.has(progressWeightKey(row.log_date,row.weight)))
  .map(row=>({
   id:"weight-log-"+String(row.id??""),
   created_at:row.created_at??null,
   analysis_date:row.log_date??null,
   weight:row.weight,
   body_fat:null,muscle_mass:null,body_water:null,visceral_fat:null,
   waist:null,chest:null,hip:null,abdomen:null,thigh:null,
   notes:"",_weightOnly:true,_progressSource:"weight_log"
  }));
 return manualRows.concat(coachRows,weightOnly).sort((a,b)=>
  String(a.analysis_date||"").localeCompare(String(b.analysis_date||""))||
  String(a.created_at||"").localeCompare(String(b.created_at||""))||
  String(a.id||"").localeCompare(String(b.id||""))
 );
}
function getTraineeProgressHistoryData(traineeId,force=false){
 const key=String(traineeId??"");
 if(!key)return Promise.resolve({analysisRows:[],weightRows:[]});
 const cached=progressHistoryReadCache.get(key);
 if(!force&&cached&&Date.now()-cached.savedAt<5000)return Promise.resolve(cached.data);
 const pending=progressHistoryReadInFlight.get(key);
 if(pending)return pending;
 const encoded=encodeURIComponent(key);
 const promise=Promise.all([
  sbGetAllPages("/body_analyses?trainee_id=eq."+encoded+"&select=id,created_at,analysis_date,weight,body_fat,muscle_mass,body_water,visceral_fat,abdomen,waist,chest,hip,thigh,notes&order=created_at.asc.nullsfirst,id.asc"),
  sbGetAllPages("/weight_logs?trainee_id=eq."+encoded+"&select=id,created_at,log_date,weight&order=created_at.asc.nullsfirst,id.asc")
 ]).then(([analysisRows,weightRows])=>{
  const data={analysisRows,weightRows};
  progressHistoryReadCache.set(key,{data,savedAt:Date.now()});
  return data;
 }).finally(()=>{
  if(progressHistoryReadInFlight.get(key)===promise)progressHistoryReadInFlight.delete(key);
 });
 progressHistoryReadInFlight.set(key,promise);
 return promise;
}

