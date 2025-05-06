# Sysadmin-tools
Just a bunch of tools I made for me, you're welcome to use them if you would like. Some of them are quite janky.

The idea behind these tools is that they all can be run locally. This means everything is native HTML + CSS + JavaScript. No server is necessary. No other software aside from a web browser. You do need to have an internet connection for some tools as we load some things off of CDNs. 

Nothing you do in the app will be sent to remote servers.

## Tools
### Diff Tool
This is a diff checker that runs locally in your browser. I used to use https://www.diffchecker.com/ but eventually I wanted something that could be run locally so I can diff files with sensitive information. I didn't want to pay so I just made my own

### CSS Color Blending Calculator
THis is a color blending tool that matches CSS outputs. You can use this to trial your colors when you are using a semi-transparent alpha overlay. I got tired of constantly refreshing or using the inspect devtools to play around with color.

There are two modes to this calculator
1. Find output. Give it your Base Color + Overlay and it will spit out the resulting color.
2. FInd overlay. Give it your Base Color + your Desired Target Color + an Alpha and it will give you an overlay that should get you your target color when placed above the base color. This calculator can sometimes be off by 1 due to rounding.

## Installation
### Running Locally
You can simply just download and unzip the repo and click on the index.html file of your choosing. If you run chrome, you will likely need the `--allow-file-access-from-files` option enabled to prevent CORS from blocking you from loading other files. Other browsers may need similar options enabled.

### Running On A Server
Running on a server is pretty straightforward if you already have some experiences setting up web servers. Just copy the files and point your web server to that directory. You may want to redirect root to a specific app.

For instance here is my apache2 configuration. We have selected the tools to be the main page using the rewrite engine

```
<IfModule mod_ssl.c>
        <VirtualHost *:443>
                ServerName tools.example.org
                ServerAdmin webmaster@phmail.ucdavis.edu

                DocumentRoot /var/www/html/tools

                <Directory /var/www/html/tools>
                        Options +FollowSymLinks
                        AllowOverride All
                        Require all granted
                </Directory>

                RewriteEngine On
                RewriteRule ^/$ /diff/ [R=302,L]

                ErrorLog ${APACHE_LOG_DIR}/tools_error.log
                CustomLog ${APACHE_LOG_DIR}/tools_access.log combined

                SSLEngine on
                SSLCertificateFile /etc/letsencrypt/live/tools.example.org/fullchain.pem
                SSLCertificateKeyFile /etc/letsencrypt/live/tools.example.org/privkey.pem
                Include /etc/letsencrypt/options-ssl-apache.conf
        </VirtualHost>
</IfModule>
```