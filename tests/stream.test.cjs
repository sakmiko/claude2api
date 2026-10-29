const test=require('node:test');const assert=require('node:assert/strict');
const {request,text,SSEDecoder,ResponseStream}=require('../web/stream.js');
test('converts text, history and image input to all three protocols',()=>{
 const messages=[{role:'user',content:[{type:'text',text:'hi'},{type:'image_url',image_url:{url:'data:image/png;base64,AAAA'}}]},{role:'assistant',content:'hello'}];
 const a=request('anthropic','model',messages,true);assert.equal(a.url,'/v1/messages');assert.deepEqual(a.body.messages[0].content[1].source,{type:'base64',media_type:'image/png',data:'AAAA'});assert.equal(a.body.max_tokens,4096);
 const r=request('responses','model',messages,false);assert.equal(r.url,'/v1/responses');assert.equal(r.body.stream,false);assert.equal(r.body.input[0].content[1].type,'input_image');
 assert.deepEqual(request('openai','model',messages).body.messages,messages);
});
test('SSE handles every boundary, CRLF, comments, multiline data and unterminated final event',()=>{
 const input='\uFEFF: keepalive\r\nevent: update\r\ndata: {"hello":\r\ndata: "world"}\r\n\r\ndata:[DONE]';
 for(const size of [1,2,7,99]){let events=[],pings=0;const parser=new SSEDecoder(e=>events.push(e),()=>pings++);for(let i=0;i<input.length;i+=size)parser.feed(input.slice(i,i+size));parser.finish();assert.equal(pings,1);assert.deepEqual(events,[{event:'update',data:'{"hello":\n"world"}'},{event:'message',data:'[DONE]'}]);}
});
for(const [protocol,frames] of [
 ['openai',[': keepalive\n\n','data:{"choices":[{"delta":{"content":"你好"}}]}\n\n','data:[DONE]\n\n']],
 ['anthropic',['event: ping\ndata:{"type":"ping"}\n\n','event: content_block_delta\ndata:{"type":"content_block_delta","delta":{"type":"text_delta","text":"你好"}}\n\n','data:{"type":"message_stop"}\n\n']],
 ['responses',[': keepalive\n\n','data:{"type":"response.output_text.delta","delta":"你好"}\n\n','data:{"type":"response.completed"}\n\n']],
])test(protocol+' streaming and keepalive',()=>{let output='';const stream=new ResponseStream(protocol,t=>output+=t);for(const char of frames.join(''))stream.feed(char);stream.finish();assert.equal(output,'你好');});
test('structured errors and incomplete streams are not successful replies',()=>{
 let output='';const stream=new ResponseStream('openai',t=>output+=t);stream.feed('data:{"choices":[{"delta":{"content":"partial"}}]}\n\n');assert.throws(()=>stream.feed('data:{"error":{"message":"overloaded"}}\n\n'),/overloaded/);assert.equal(output,'partial');
 assert.throws(()=>new ResponseStream('responses',()=>{}).finish(),/提前结束/);
 assert.throws(()=>new ResponseStream('anthropic',()=>{}).feed('event: error\ndata:{"type":"error","error":{"message":"rate limited"}}\n\n'),/rate limited/);
});
test('non-streaming replies normalize equally',()=>{
 assert.equal(text('openai',{choices:[{message:{content:'ok'}}]}),'ok');assert.equal(text('anthropic',{content:[{type:'text',text:'ok'}]}),'ok');assert.equal(text('responses',{output:[{type:'message',content:[{type:'output_text',text:'ok'}]}]}),'ok');
});
test('a completed response ignores late frames',()=>{
 let output='';const stream=new ResponseStream('openai',t=>output+=t);
 stream.feed('data:{"choices":[{"delta":{"content":"done"}}]}\n\ndata:[DONE]\n\ndata:not-json\n\n');
 stream.finish();assert.equal(output,'done');assert.equal(stream.completed,true);
});
