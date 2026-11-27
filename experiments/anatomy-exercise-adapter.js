(function(root){
  'use strict';
  function normalizeLabel(value){
    return String(value==null?'':value)
      .replace(/[ي]/g,'ی').replace(/[ك]/g,'ک')
      .replace(/\s+/g,' ').trim();
  }
  function create(mapping){
    if(!mapping || !Array.isArray(mapping.labels)) throw new TypeError('Valid anatomy mapping is required.');
    const index=new Map();
    mapping.labels.forEach(item=>{
      const key=normalizeLabel(item.source_label);
      if(!key) return;
      if(index.has(key)) throw new Error('Duplicate source label in anatomy mapping: '+key);
      index.set(key,item);
    });
    function filterExercises(exercises,selectedGroupIds,options){
      if(!Array.isArray(exercises)) throw new TypeError('exercises must be an array');
      const selected=new Set((selectedGroupIds||[]).map(String));
      if(!selected.size) return [];
      const opts=options||{};
      const strictOnly=opts.strictOnly===true;
      const output=[];
      exercises.forEach(row=>{
        if(!row || row.id==null) return;
        const label=normalizeLabel(row.target_muscle);
        if(!label) return;
        const rule=index.get(label);
        if(!rule || rule.mapping==='unmapped') return;
        if(strictOnly && rule.mapping!=='exact_group') return;
        const matched=(rule.anatomy_group_ids||[]).filter(id=>selected.has(id));
        if(!matched.length) return;
        output.push({
          exercise:row,
          matched_group_ids:matched,
          match_type:rule.mapping,
          confidence:rule.confidence||'none',
          role:null,
          role_status:'not_available_in_current_schema'
        });
      });
      return output;
    }
    return Object.freeze({filterExercises});
  }
  root.SehAnatomyExerciseAdapter=Object.freeze({create,normalizeLabel});
})(typeof globalThis!=='undefined'?globalThis:this);
