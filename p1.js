import { EC2Client, RunInstancesCommand, DescribeInstancesCommand, TerminateInstancesCommand } from "@aws-sdk/client-ec2";
import { S3Client, CreateBucketCommand, ListBucketsCommand, PutObjectCommand, DeleteBucketCommand, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { SQSClient, CreateQueueCommand, ListQueuesCommand, SendMessageCommand, GetQueueAttributesCommand, ReceiveMessageCommand, DeleteMessageCommand, DeleteQueueCommand } from "@aws-sdk/client-sqs";

import { credentials } from "./credentials.js";

const region = "us-west-1"; 

const ec2Client = new EC2Client({ credentials, region });
const s3Client = new S3Client({ credentials, region });
const sqsClient = new SQSClient({ credentials, region });


async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function createResources() {
  console.log("Creating resources...");

  const ec2Params = {
    ImageId: "ami-0d53d72369335a9d6", 
    InstanceType: "t2.micro",
    MinCount: 1,
    MaxCount: 1
  };
  const ec2Command = new RunInstancesCommand(ec2Params);
  const ec2Response = await ec2Client.send(ec2Command);
  const instanceId = ec2Response.Instances[0].InstanceId;
  console.log(`EC2 instance created with ID: ${instanceId}`);

  const bucketName = `my-test-bucket-${Date.now()}`;
  const s3Command = new CreateBucketCommand({ Bucket: bucketName });
  await s3Client.send(s3Command);
  console.log(`S3 bucket created: ${bucketName}`);

  const queueName = `my-test-queue-${Date.now()}`;
  const sqsCommand = new CreateQueueCommand({ QueueName: queueName });
  const sqsResponse = await sqsClient.send(sqsCommand);
  const queueUrl = sqsResponse.QueueUrl;
  console.log(`SQS queue created: ${queueUrl}`);

  console.log("Resources created, waiting for 1 minute...");
  await sleep(60000);

  return { instanceId, bucketName, queueUrl };
}

async function listResources() {
  console.log("Listing resources...");

  const ec2Command = new DescribeInstancesCommand({
  });
  const ec2Response = await ec2Client.send(ec2Command);
  console.log("EC2 Instances:");
  ec2Response.Reservations?.forEach(reservation => {
    reservation.Instances.forEach(instance => {
      if(instance.State.Name === 'running') {
        console.log(`  ${instance.InstanceId}`);
      }
    });
  });

  const s3Command = new ListBucketsCommand({});
  const s3Response = await s3Client.send(s3Command);
  console.log("S3 Buckets:");
  s3Response.Buckets?.forEach(bucket => {
    console.log(`  ${bucket.Name}`);
  });

  const sqsCommand = new ListQueuesCommand({});
  const sqsResponse = await sqsClient.send(sqsCommand);
  console.log("SQS Queues:");
  sqsResponse.QueueUrls?.forEach(queueUrl => {
    console.log(`  ${queueUrl}`);
  });
}

async function uploadFileToS3(bucketName) {
  console.log("Uploading file to S3...");
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: "CSE546test.txt",
    Body: "",
  });
  await s3Client.send(command);
  console.log("File uploaded to S3");
}

async function sendMessageToSQS(queueUrl) {
  console.log("Sending message to SQS...");
  const command = new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: "This is a test message",
    MessageAttributes: {
      "Title": {
        DataType: "String",
        StringValue: "test message"
      }
    }
  });
  await sqsClient.send(command);
  console.log("Message sent to SQS");
}

async function checkSQSMessages(queueUrl) {
  const command = new GetQueueAttributesCommand({
    QueueUrl: queueUrl,
    AttributeNames: ["ApproximateNumberOfMessages"]
  });
  const response = await sqsClient.send(command);
  console.log(`Number of messages in SQS queue: ${response.Attributes.ApproximateNumberOfMessages}`);
}

async function receiveSQSMessage(queueUrl) {
  console.log("Receiving message from SQS...");
  const command = new ReceiveMessageCommand({
    QueueUrl: queueUrl,
    MaxNumberOfMessages: 1,
    MessageAttributeNames: ["All"]
  });
  const response = await sqsClient.send(command);
  if (response.Messages && response.Messages.length > 0) {
    const message = response.Messages[0];
    console.log(`Message title: ${message.MessageAttributes.Title.StringValue}`);
    console.log(`Message body: ${message.Body}`);

    const deleteCommand = new DeleteMessageCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: message.ReceiptHandle
    });
    await sqsClient.send(deleteCommand);
  } else {
    console.log("No messages in the queue");
  }
}

async function deleteResources(instanceId, bucketName, queueUrl) {
  console.log("Deleting resources...");

  let isTruncated = true;
  let continuationToken = undefined;

  while (isTruncated) {
    const listCommand = new ListObjectsV2Command({
      Bucket: bucketName,
      ContinuationToken: continuationToken,
    });

    const listResponse = await s3Client.send(listCommand);

    if (listResponse.Contents) {
      for (const object of listResponse.Contents) {
        const deleteCommand = new DeleteObjectCommand({
          Bucket: bucketName,
          Key: object.Key,
        });
        await s3Client.send(deleteCommand);
        console.log(`Deleted object: ${object.Key}`);
      }
    }

    isTruncated = listResponse.IsTruncated;
    continuationToken = listResponse.NextContinuationToken;
  }

  const ec2Command = new TerminateInstancesCommand({ InstanceIds: [instanceId] });
  await ec2Client.send(ec2Command);
  console.log(`EC2 instance ${instanceId} termination initiated`);

  const s3Command = new DeleteBucketCommand({ Bucket: bucketName });
  await s3Client.send(s3Command);
  console.log(`S3 bucket ${bucketName} deleted`);

  const sqsCommand = new DeleteQueueCommand({ QueueUrl: queueUrl });
  await sqsClient.send(sqsCommand);
  console.log(`SQS queue ${queueUrl} deleted`);
}

async function main() {
  try {
    const { instanceId, bucketName, queueUrl } = await createResources();
    await listResources();
    await uploadFileToS3(bucketName);
    await sendMessageToSQS(queueUrl);
    await checkSQSMessages(queueUrl);
    await receiveSQSMessage(queueUrl);
    await checkSQSMessages(queueUrl);
    
    console.log("Waiting for 10 seconds...");
    await sleep(10000);
    
    await deleteResources(instanceId, bucketName, queueUrl);
    
    console.log("Waiting for 1 minute...");
    await sleep(60000);
    
    await listResources();
  } catch (error) {
    console.error("An error occurred:", error);
  }
}

main();
