import * as pulumi from "@pulumi/pulumi";
import * as docker from "@pulumi/docker";

import * as containerregistry from "@pulumi/azure-native/containerregistry";
import * as operationalinsights from "@pulumi/azure-native/operationalinsights";
import * as resources from "@pulumi/azure-native/resources";
import * as app from "@pulumi/azure-native/app";

const resourceGroup = new resources.ResourceGroup("rg");

const workspace = new operationalinsights.Workspace("loganalytics", {
    resourceGroupName: resourceGroup.name,
    sku: {
        name: "PerGB2018",
    },
    retentionInDays: 30,
});

const workspaceSharedKeys = operationalinsights.getSharedKeysOutput({
    resourceGroupName: resourceGroup.name,
    workspaceName: workspace.name,
});

const registry = new containerregistry.Registry("regsitry", {
    resourceGroupName: resourceGroup.name,
    sku: {
        name: "Basic"
    },
})

const credentials = containerregistry.listRegistryCredentialsOutput({
    resourceGroupName: resourceGroup.name,
    registryName: registry.name,
});
const adminUsername = credentials.apply(c => c.username!);
const adminPassword = credentials.apply(c => c.passwords![0].value!);

const myDockerApp = new docker.Image("node-app", {
    imageName: "node-app:v1.0.0",
    build: {
        context: "./node-app"
    },
    registry: {
        server: registry.loginServer,
        username: adminUsername,
        password: adminPassword,
    }
})

const kubeEnv = new app.ManagedEnvironment("env", {
    resourceGroupName: resourceGroup.name,
    appLogsConfiguration: {
        destination: "log-analytics",
        logAnalyticsConfiguration: {
            customerId: workspace.customerId,
            sharedKey: workspaceSharedKeys.apply(r => r.primarySharedKey!),
        },
    },
});

const containerApp = new app.ContainerApp("app", {
    resourceGroupName: resourceGroup.name,
    managedEnvironmentId: kubeEnv.id,
    configuration: {
        ingress: {
            external: true,
            targetPort: 80,
        },
        registries: [{
            server: registry.loginServer,
            username: adminUsername,
            passwordSecretRef: "pwd",
        }],
        secrets: [{
            name: "pwd",
            value: adminPassword,
        }]
    },
    template: {
        containers: [{
            name: "myapp",
            image: myDockerApp.imageName,
        }],
    },
});

export const url = pulumi.interpolate`https://${containerApp.configuration.apply(c => c?.ingress?.fqdn)}`;

