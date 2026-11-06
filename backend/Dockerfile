# Use official Node.js image with Python included
FROM nikolaik/python-nodejs:python3.11-nodejs20

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Node dependencies
COPY package*.json .
RUN npm install --production

# Copy all backend files
COPY . .

EXPOSE 4000

CMD ["node", "server.js"]
